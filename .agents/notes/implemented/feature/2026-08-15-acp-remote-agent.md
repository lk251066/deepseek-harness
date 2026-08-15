# Agent Note: ACP Remote Agents over WSL/SSH

Status: implemented

English | [中文](2026-08-15-acp-remote-agent.zh.md)

## Problem

The terminal front door could only delegate to subagents on the SAME machine: the ACP client provider (`dsh-subagent-acp`) could already spawn any argv, but its cwd handling stat'ed a local directory, its permission prompts were auto-answered with no human, and the remote side had no one-command server profile. The workstation vision needs a WSL or SSH machine's dsh drivable as a subagent, with the remote machine's dangerous-tool asks surfaced in the local TUI's approval dialog.

## Decisions

**Two cwd roles, split at the run spec.** A `wsl`/`ssh` transport process runs LOCALLY and cannot chdir into `/home/...`, so `AcpRunSpec` now carries `spawnCwd` (the local anchor; a remote world pins it to the harness process cwd) beside `cwd` (the ACP session workspace). A new `cwdWorld: 'remote'` config validates the cwd purely syntactically at load — non-empty, absolute on the remote machine (posix `/`, Windows drive, or UNC), never resolved against the local launch directory — and is REQUIRED, because the delegating parent's cwd is local-machine state that must not leak into a remote workspace declaration. The `local` default is byte-identical to the previous behavior.

**Permission asks relay through the parent's approval waterfall.** `permission: 'ask'` forwards the child's `session/request_permission` to `AcpRunSpec.requestApproval`, which the provider wires to `ctx.get('approval')` (the tools seam's opportunistic-read precedent — the service stays optional at runtime) with `agent: request.parent` and a provider-namespaced tool name (`acp:bash`): a TUI's per-slot answerer claims exactly its own agent, so the existing approval dialog decides, and a session-scoped "always allow acp:bash" can never greenlight the LOCAL bash. Every degraded path — service absent, request rejected, throwing waterfall — resolves `unavailable`, which the response mapping turns into a cancelled ask (fail-closed: the child never proceeds on an unresolved ask).

**Race closure via a run-settled controller.** The ask's signal is the run's request signal plus a `runSettled` AbortController aborted when the result settles or dispose runs: a cancelled run or crashed child retracts a still-pending human ask immediately, and a late answer lands on a settled run harmlessly. Known limit: ACP has no message to RETRACT a pending permission request, so when the remote times out first the client may show one stale dialog whose answer is discarded.

**The bridge carries what a human needs.** `dsh-acp` now sends the tool name as the toolCall `title` and the ask's reason (the actual command line) in the protocol-reserved `_meta` extension slot — no protocol change; both wire ends are this repo.

**A stock server profile.** `dsh-acp-bundle` (pure config over dsh-base: HMR off so stdout stays JSON-RPC, one inserted `dsh-acp` row with `DSH_ACP_PROVIDER`/`DSH_ACP_MODEL`-pinnable routing) plus a `PROFILE_TEMPLATES.acp` entry: the remote machine serves with `dsh --profile acp` and zero assembly.

## Consequences

- Credentials live on the SERVING machine: `wsl`/`ssh` do not forward the client environment, and argv must never carry a key (process listings are world-readable). `spec.env` still reaches a LOCAL child normally.
- The client's parent approval policy gates relays: under `danger-full-access` (policy `never`) remote asks are auto-rejected without a dialog — `ask` needs the client in `workspace-write`.
- Remote runs stay invisible in `/agents` (out-of-process runs were already), and only `agent_message_chunk` text returns — unchanged provider semantics.
- The provider advertises no start capabilities, so the remote `tool-subagent` instance must use `maxDepth: 'provider-managed'` and one-shot mode (no continuable background).
- Test evidence: keyless suite covers cwd worlds (local unchanged + remote anchor/session split, syntax rejections), the ask relay (parent attribution, namespacing, `_meta` reason, all outcome mappings and both no-option degrades, absent/throwing service, abort-while-pending), and the bridge title/reason; a real `dsh --profile acp --dump-config` boots the bundle; a ConPTY loopback smoke (TUI → subagent-acp → `--profile acp` child → remote ask → TUI dialog → allow → completion) exercises the full chain on a real terminal.
