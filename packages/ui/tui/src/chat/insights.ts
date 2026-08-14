/**
 * Insight surfaces for the terminal: the `/context` occupancy breakdown, the
 * prompt-row stats strip, the `/agents` and `/jobs` monitors, `/settings`, and
 * the `/export` markdown transcript. All read optional services (`ctx.get`) so
 * the TUI mounts in embedder bundles without them.
 * @module @deepseek-ai/dsh-tui/chat/insights
 */

import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { diagnosticMeter, formatDiagnosticNumber, contextMeter, StaticDialog } from '../components/dialogs.ts'
import type { Palette } from '../components/theme.ts'
import { displayText } from '../components/text.ts'
import { contentText } from '../components/content.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** Collaborators the insight surfaces need from the chat channel. */
export interface InsightsDeps extends ChatChannelDeps, ChannelNotice {
  /** The agent whose session every surface reads. */
  agent: Agent
}

/** The `sessionStats` projection shape (absent when the plugin is not mounted). */
interface SessionStats {
  turns?: number
  steps?: number
  llmMs?: number
  ttftMs?: number
  ttftSteps?: number
  decodeMs?: number
  decodeTokens?: number
}

/**
 * One compact stats-strip value for the LEFT prompt row (the right prompt
 * crowds out the left when both are wide, so the strip lives after the context
 * bar and is the first thing a narrow terminal truncates). `undefined` without
 * the sessionStats projection.
 */
export function statsStrip(deps: InsightsDeps): string | undefined {
  const stats = projectionValue<SessionStats>(deps, 'sessionStats')
  if (stats === undefined) return undefined
  const parts: string[] = []
  if (stats.turns !== undefined && stats.turns > 0) parts.push(`${stats.turns} turns`)
  if (stats.decodeMs !== undefined && stats.decodeTokens !== undefined && stats.decodeMs > 0 && stats.decodeTokens > 0) {
    parts.push(`${Math.round(stats.decodeTokens / (stats.decodeMs / 1000))} tok/s`)
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** Read one projection value off the optional projection registry. */
function projectionValue<T>(deps: InsightsDeps, key: string): T | undefined {
  const projections = deps.ctx.get('sessionProjections') as {
    snapshot?: (session: Session) => { values?: Record<string, unknown> } | undefined
  } | undefined
  if (projections === undefined) return undefined
  try {
    const value = projections.snapshot?.(deps.agent.session)?.values?.[key]
    return value === undefined ? undefined : value as T
  } catch {
    return undefined
  }
}

/** The `/context` body rows: occupancy header, segmented bar, per-source rows. */
export function contextLines(deps: InsightsDeps, palette: Palette): string[] {
  const pressure = projectionValue<{ projectedTokens?: number; pressureTokens?: number; contextWindow?: number }>(deps, 'contextPressure')
  const breakdown = projectionValue<{ systemTokens?: number; toolsTokens?: number; messageTokens?: number }>(deps, 'contextBreakdown')
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
    ?? deps.ctx.tokenMeter.measure(deps.agent.session).totalTokens
  const window = pressure?.contextWindow
  const rows: string[] = []
  if (window === undefined || window <= 0) {
    rows.push(`${formatDiagnosticNumber(used)} tokens in play · context window unknown`)
    return rows
  }
  const percent = Math.min(100, used / window * 100)
  rows.push(palette.bold(`~${formatDiagnosticNumber(used)} / ${formatDiagnosticNumber(window)} · ${Math.round(percent)}%`))
  rows.push(`${contextMeter(percent, palette)} ${diagnosticMeter(percent, palette)}`)
  if (breakdown !== undefined) {
    const system = breakdown.systemTokens ?? 0
    const tools = breakdown.toolsTokens ?? 0
    const messages = breakdown.messageTokens ?? 0
    const total = Math.max(1, system + tools + messages)
    const bar = (tokens: number): string => '█'.repeat(Math.max(1, Math.round(tokens / total * 10)))
    rows.push('', `system   ${palette.dim(bar(system))} ${formatDiagnosticNumber(system)}`)
    rows.push(`tools    ${palette.dim(bar(tools))} ${formatDiagnosticNumber(tools)}`)
    rows.push(`messages ${palette.dim(bar(messages))} ${formatDiagnosticNumber(messages)}`)
    rows.push('', palette.dim('Heuristic composition — proportions are approximate.'))
  }
  return rows
}

/** The `/agents` body rows over the subagent descendant list. */
/** One `/agents` row: a descendant subagent session. */
interface SubagentEntry {
  kind: string
  id: string
  label?: string
  mode?: string
  activity?: string
  depth?: number
}

export async function agentsLines(deps: InsightsDeps, signal: AbortSignal): Promise<string[]> {
  const subagents = deps.ctx.get('subagents') as {
    listDescendants?(rootSessionId: unknown, signal?: AbortSignal): Promise<Array<SubagentEntry>>
  } | undefined
  if (subagents?.listDescendants === undefined) {
    return ['Subagents are not available in this session.']
  }
  const entries = await subagents.listDescendants(deps.agent.session.id, signal)
  if (entries.length === 0) return ['No subagent sessions.']
  return entries.map((entry) => {
    const status = entry.kind === 'child' ? (entry.activity ?? 'inactive') : 'unavailable'
    const mode = entry.mode === undefined ? '' : ` · ${entry.mode}`
    const depth = entry.depth !== undefined && entry.depth > 0 ? ` · depth ${entry.depth}` : ''
    return `${status === 'running' ? '●' : status === 'inactive' ? '○' : '·'} ${displayText(entry.label ?? entry.id)}${mode}${depth}`
  })
}

/** One `/jobs` row: a background job owned by a session. */
interface JobSnapshotRow {
  id: string
  status: string
  label?: string
  ownerSession?: unknown
}

/** The `/jobs` body rows over the job registry, filtered to this session. */
export function jobsLines(deps: InsightsDeps): string[] {
  const jobs = deps.ctx.get('jobs') as {
    list?: (caller?: unknown) => Array<JobSnapshotRow>
  } | undefined
  if (jobs?.list === undefined) return ['Background jobs are not available in this session.']
  const mine = jobs.list(deps.agent).filter(job => job.ownerSession === undefined || job.ownerSession === deps.agent.session.id)
  if (mine.length === 0) return ['No background jobs.']
  return mine.map(job => `${job.status.padEnd(9)} ${job.id.padEnd(12)} ${displayText(job.label ?? '')}`)
}

/** One `/settings` row: a namespace with its user-override marker. */
interface SettingsDescriptor {
  ns: string
  user?: unknown
  applies?: boolean
  revision?: number
}

/** The `/settings` body rows over the settings registry (secrets redacted). */
export function settingsLines(deps: InsightsDeps): string[] {
  const settings = deps.ctx.get('settings') as {
    describe?: (options: { redactSecrets: boolean }) => Array<SettingsDescriptor>
    documentPath?: () => string | undefined
  } | undefined
  if (settings?.describe === undefined) return ['Settings are not available in this session.']
  const rows = settings.describe({ redactSecrets: true }).map(descriptor =>
    `${descriptor.user === undefined ? ' ' : '*'} ${descriptor.ns.padEnd(16)} ${descriptor.user === undefined ? 'default' : 'user override'}`)
  const path = settings.documentPath?.()
  return [...rows, '', `Edit ${path ?? 'the settings file'} — changes hot-reload.`]
}

/** Render one message's blocks as markdown-ish text for `/export`. */
function exportBlocks(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' || block.type === 'reasoning') {
      if (block.type === 'reasoning') parts.push(`> [reasoning] ${block.text.replace(/\n/gu, '\n> ')}`)
      else parts.push(block.text)
    } else if (block.type === 'tool-call') {
      parts.push(`\`\`\`json\n{"tool": "${block.name}", "arguments": ${block.arguments}}\n\`\`\``)
    } else if (block.type === 'tool-result') {
      const text = contentText(block.content).trim()
      parts.push(text === '' ? '`(empty result)`' : `\`\`\`\n${text.slice(0, 2_000)}\n\`\`\``)
    } else if (block.type === 'image') {
      parts.push(`[image: ${block.attachment.attachmentId}]`)
    }
  }
  return parts.join('\n\n')
}

/** Render the whole session log as a markdown transcript. */
export function exportMarkdown(session: Session): string {
  const lines: string[] = [`# ${String(session.id)} — transcript export`, '']
  for (const event of session.events) {
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        const message = data.message as Message | undefined
        if (message === undefined) break
        const source = data.source as { kind?: string } | undefined
        lines.push(`## ${source?.kind === 'user' ? 'User' : `Context (${source?.kind ?? 'plugin'})`}`, '', exportBlocks(message.content), '')
        break
      }
      case 'assistant/message': {
        const message = data.message as Message | undefined
        if (message !== undefined) lines.push('## Assistant', '', exportBlocks(message.content), '')
        break
      }
      case 'todo/write':
        lines.push('**Todos**', '', ...(data.todos as Array<{ content: string; status: string }> ?? [])
          .map(todo => `- [${todo.status === 'completed' ? 'x' : ' '}] ${todo.content}`), '')
        break
      default:
        break
    }
  }
  return `${lines.join('\n')}\n`
}

/** Write the transcript atomically (temp file + rename) and return the path. */
export function writeExport(cwd: string, session: Session): string {
  const path = join(cwd, `dsh-export-${String(session.id)}-${new Date().toISOString().replace(/[:.]/gu, '-')}.md`)
  const temp = `${path}.tmp-${randomUUID()}`
  writeFileSync(temp, exportMarkdown(session), 'utf8')
  renameSync(temp, path)
  return path
}

/** Open one static insight overlay. */
export function openStaticDialog(
  deps: InsightsDeps,
  title: string,
  lines: readonly string[],
  refresh?: () => readonly string[],
): void {
  const session = deps.overlayManager.open({
    create: () => new StaticDialog(title, lines, deps.palette, () => { void session.close() }, refresh),
    options: { width: 76, maxHeight: 24, anchor: 'center', margin: 1 },
  })
  deps.requestRender()
}
