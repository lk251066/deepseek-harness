/**
 * Shift+Tab permission-preset cycling, the Claude Code mode ring adapted to
 * dsh's preset table: read-only → workspace-write → danger-full-access (the
 * shipped order). Selecting the danger preset confirms first, mirroring the
 * web surface's risk acknowledgement.
 * @module @deepseek-ai/dsh-tui/chat/permission
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** The permission-presets service surface the TUI reads (optional at runtime). */
export interface PermissionPresetsService {
  readonly names: readonly string[]
  current(events: readonly unknown[]): string
  resolve(name: string): { sandbox: string, approval?: string, description?: string }
  set(session: unknown, name: string): unknown
}

/** Collaborators the permission ring needs from the chat channel. */
export interface PermissionDeps extends ChatChannelDeps, ChannelNotice {
  /** The agent whose session's preset cycles. */
  agent: Agent
  /** Open the danger-preset confirmation overlay. */
  confirmRisk(message: string, onChoice: (confirmed: boolean) => void): void
}

/** Permission-ring controller for one chat channel. */
export interface PermissionController {
  /** Shift+Tab: switch to the next preset (confirming the danger one). */
  cycle(): void
  /** The effective preset name for the prompt chip, when presets are mounted. */
  chip(): string | undefined
}

/**
 * Build the Shift+Tab permission ring for one chat channel.
 * @param deps - channel collaborators and the risk-confirmation host.
 * @returns the controller wired into the input listener and prompt values.
 */
export function createPermissionController(deps: PermissionDeps): PermissionController {
  const { ctx, agent } = deps
  const presets = (): PermissionPresetsService | undefined =>
    ctx.get('permissionPresets') as PermissionPresetsService | undefined

  const apply = (name: string): void => {
    const service = presets()
    if (service === undefined) return
    try {
      service.set(agent.session, name)
      const option = service.resolve(name)
      deps.appendNotice(`Permission preset: ${option.description ?? name}`)
    } catch (error) {
      deps.appendNotice(`Failed to switch permission preset: ${String(error)}`, 'error')
    }
  }

  return {
    cycle(): void {
      const service = presets()
      if (service === undefined) {
        deps.appendNotice('Permission presets are not available in this session.', 'warning')
        return
      }
      const names = service.names
      if (names.length === 0) return
      const index = names.indexOf(service.current(agent.session.events))
      // `custom` (index -1) restarts the ring from the most restrictive entry.
      const next = names[(index + 1 + names.length) % names.length] ?? names[0]
      if (next === undefined) return
      const spec = service.resolve(next)
      if (spec.sandbox === 'danger-full-access') {
        deps.confirmRisk(
          'danger-full-access disables the sandbox AND approval prompts — the agent can run any command and edit any file.',
          confirmed => { if (confirmed) apply(next) },
        )
        return
      }
      apply(next)
    },
    chip(): string | undefined {
      const service = presets()
      return service === undefined ? undefined : service.current(agent.session.events)
    },
  }
}
