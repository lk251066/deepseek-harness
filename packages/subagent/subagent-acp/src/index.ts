/**
 * Out-of-process ACP subagent backend. Each child has its own process, session, model, and
 * tools, so it shares no Cordis context and advertises no parent-enforced start capabilities;
 * the ONE thing it reads off `request.parent` is the session's workspace cwd (see
 * {@link resolveCwd}). This plugin uses named exports only; a default would hide its
 * loader metadata (see `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @deepseek-ai/dsh-subagent-acp
 */

import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  type AcpRunSpec,
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
  type PermissionPolicy,
  type RemoteApprovalOutcome,
  startAcpRun,
} from './run.ts'

/**
 * The minimal user-approval surface the `ask` relay consumes — a structural
 * read like the ACP bridge's `ContinuableDrain`, so this package stays
 * dependency-light against an optional-at-runtime service.
 */
interface ApprovalRelay {
  request(ask: {
    agent: SubagentStartRequest['parent']
    toolName: string
    reason?: string
    signal?: AbortSignal
  }): Promise<RemoteApprovalOutcome>
}

export const name = 'subagent-acp'
export const inject = ['subagents', 'subprocess']

/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * In a `local` world must be non-empty; a relative path resolves against
   * the harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child inherits its delegating parent
   * session's cwd — and starting one from a parent session that has no cwd
   * fails. In a `remote` world the value is a REMOTE path (see
   * {@link cwdWorld}) and is required.
   */
  cwd?: string
  /**
   * Which machine `cwd` names. `local` (default): the path is a local
   * directory the child process enters directly. `remote`: the child is a
   * transport process (`wsl`, `ssh`) — `cwd` is the REMOTE workspace handed
   * to the child agent's ACP session, syntactically validated only (the
   * local host cannot stat it), and REQUIRED (the delegating parent's cwd is
   * local-machine semantics and must not leak into a remote world).
   */
  cwdWorld: 'local' | 'remote'
  /**
   * How to answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt), `allow` (approve via the first
   * `allow_once` or `allow_always` option), or `ask` (relay to a HUMAN: the
   * parent process's approval waterfall answers, so a TUI shows its approval
   * dialog and the decision flows back to the child).
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().default('acp'),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  cwdWorld: z.union(['local', 'remote'] as const).default('local'),
  permission: z.union(['allow', 'reject', 'ask'] as const).default('reject'),
  env: z.dict(z.string()).default({}),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** A dispose grace must fit the single Node timer that owns its teardown tier. */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`subagent-acp: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** The shape after schemastery applied the defaults (cwd has none). */
type ResolvedConfig = Required<Omit<Config, 'cwd'>> & Pick<Config, 'cwd'>

/**
 * Whether `path` names an existing directory the harness can ENTER. The
 * search-permission probe matters: `statSync().isDirectory()` is true for a
 * mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
 */
function isDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // statSync/accessSync throw only filesystem access errors here
    // (ENOENT/EACCES/ENOTDIR/…), and every one of them means the path cannot
    // serve as the child's cwd.
    return false
  }
}

/**
 * Assert `cwd` can actually host the child: absolute (it doubles as the ACP
 * session workspace, and a relative path would be re-anchored to the server
 * process's launch directory) and an existing directory (fail here, before the
 * process boundary, instead of as an ambiguous spawn ENOENT).
 * @param label - which source supplied the value, for the diagnostic.
 * @param cwd - the candidate working directory.
 * @returns `cwd`, validated.
 */
function assertUsableCwd(label: string, cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new Error(`subagent-acp: ${label} must be an absolute path: ${cwd}`)
  }
  if (!isDirectory(cwd)) {
    throw new Error(`subagent-acp: ${label} is not an accessible directory: ${cwd}`)
  }
  return cwd
}

/**
 * Resolve the child's working directory: the deployment `cwd` override when
 * configured (already validated at load), else the parent session's workspace
 * cwd (validated here, its earliest resolvable point). Fails loud when neither
 * exists — falling back to the harness process cwd would silently bind the
 * child to the server's launch directory instead of the delegating session's
 * workspace (one server process serves many sessions, each with its own cwd).
 */
function resolveCwd(configured: string | undefined, request: SubagentStartRequest): string {
  if (configured !== undefined) return configured
  const parentCwd = request.parent.session.header.cwd
  if (parentCwd === undefined) {
    throw new Error('subagent-acp: no working directory for the child — configure `cwd` or delegate from a parent session that has one')
  }
  return assertUsableCwd('parent session cwd', parentCwd)
}

/**
 * Absolute in a REMOTE world: a posix path (`/home/...`), a Windows drive
 * (`C:\...` / `C:/...`), or a UNC path (`\\server\share\...`). Syntactic only
 * — the local host cannot stat the remote machine's directories, so load-time
 * validation stops at the shape and the child's own `session/new` remains the
 * authority on whether the workspace exists.
 */
function isRemoteAbsolute(path: string): boolean {
  return path.startsWith('/')
    || path.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/u.test(path)
}

/**
 * Validate a `remote`-world configured cwd: non-empty, syntactically absolute
 * on the remote machine, never relative (a relative path must NOT be resolved
 * against the local launch directory — that would silently inject a local
 * directory into a remote workspace declaration).
 * @param cwd - the configured remote workspace path.
 * @returns `cwd`, validated.
 */
function assertRemoteCwd(cwd: string): string {
  if (cwd === '') {
    throw new Error('subagent-acp: config cwd must not be empty')
  }
  if (!isRemoteAbsolute(cwd)) {
    throw new Error(`subagent-acp: remote cwdWorld requires an absolute remote path: ${cwd}`)
  }
  return cwd
}

/**
 * The ACP provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `outputSchema`/`maxDepth`/`toolFilter` (the service rejects
 * a request needing any of them before `start` runs).
 */
class AcpProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = { outputSchema: false, depthLimit: false, toolFilter: false, persona: false }
  // Context contract: an out-of-process ACP child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  start(request: ResolvedSubagentStartRequest) {
    // Two cwd roles: the ACP session workspace (world-specific) and the local
    // spawn anchor. A local child enters its session cwd directly; a remote
    // transport (`wsl`, `ssh`) runs locally and anchors at the harness cwd
    // while the session cwd names the REMOTE workspace.
    const sessionCwd = this.config.cwdWorld === 'remote'
      ? this.remoteSessionCwd()
      : resolveCwd(this.config.cwd, request)
    const spec: AcpRunSpec = {
      command: this.config.command,
      args: this.config.args,
      cwd: sessionCwd,
      spawnCwd: this.config.cwdWorld === 'remote' ? process.cwd() : sessionCwd,
      permission: this.config.permission,
      env: this.config.env,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      ...(this.config.permission === 'ask'
        ? { requestApproval: ask => this.relayApproval(request, ask.toolName, ask) }
        : {}),
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-acp "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startAcpRun(request, spec)
  }

  /**
   * Relay one child permission ask into the parent process's user-approval
   * waterfall, attributed to the DELEGATING parent agent — a TUI's per-slot
   * answerer claims exactly that agent, so its approval dialog handles the
   * ask. The tool name is provider-namespaced so a session-scoped grant
   * ("always allow acp:bash") can never greenlight the local bash. Fail-closed
   * on every degraded path: service absent, request rejected, or a throwing
   * waterfall resolves `unavailable`, which the run maps to a cancelled ask.
   */
  private async relayApproval(
    request: ResolvedSubagentStartRequest,
    toolName: string,
    ask: { reason?: string; signal: AbortSignal },
  ): Promise<RemoteApprovalOutcome> {
    const approval = this.ctx.get('approval') as ApprovalRelay | undefined
    if (approval === undefined) return 'unavailable'
    const namespaced = `${this.name}:${toolName}`
    try {
      return await approval.request({
        agent: request.parent,
        toolName: namespaced,
        ...ask.reason === undefined ? {} : { reason: ask.reason },
        signal: ask.signal,
      })
    } catch (error) {
      this.ctx.logger.warn(`subagent-acp "${this.name}": permission relay failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'unavailable'
    }
  }

  /** The load-validated remote workspace; the guard below is unreachable in a composed deployment. */
  private remoteSessionCwd(): string {
    const cwd = this.config.cwd
    /* v8 ignore next -- apply() rejects a remote world without a configured cwd before a provider exists. */
    if (cwd === undefined) throw new Error('subagent-acp: remote cwdWorld requires a configured cwd')
    return cwd
  }
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveFinite('disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('disposeGraceMs', resolved.disposeGraceMs)
  // A remote world is purely syntactic at load: the path names a directory on
  // ANOTHER machine, so the local stat does not apply, and the delegating
  // parent's (local-machine) cwd must not be inherited into it.
  if (resolved.cwdWorld === 'remote') {
    if (resolved.cwd === undefined) {
      throw new Error('subagent-acp: remote cwdWorld requires a configured cwd — the parent session cwd is local-machine semantics and cannot name a remote workspace')
    }
    ctx.subagents.registerProvider(new AcpProvider(resolved.providerName, ctx, {
      ...resolved,
      cwd: assertRemoteCwd(resolved.cwd),
    }))
    return
  }
  // `path.resolve('')` is the process cwd — an empty string would silently
  // reintroduce the launch-directory fallback this resolution removed.
  if (resolved.cwd === '') {
    throw new Error('subagent-acp: config cwd must not be empty — omit the key to inherit the parent session cwd')
  }
  // Interpret a relative configured cwd against the harness launch directory
  // ONCE, at load, and fail a misconfigured directory here — not per start.
  const validated: ResolvedConfig = resolved.cwd === undefined
    ? resolved
    : { ...resolved, cwd: assertUsableCwd('config cwd', resolve(resolved.cwd)) }
  ctx.subagents.registerProvider(new AcpProvider(validated.providerName, ctx, validated))
}
