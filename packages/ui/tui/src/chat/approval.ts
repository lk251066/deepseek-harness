/**
 * Tool-approval sub-machine for the interactive chat channel. Claims the
 * `approval/request` waterfall for THIS channel's agent and answers it with a
 * keyboard overlay — the terminal counterpart of the web ApprovalPanel, and the
 * difference between a tool call that runs and one that fails closed with
 * "no approval channel available".
 *
 * Every claimed request resolves on ALL paths (choice, Esc, abort, overlay
 * error, shutdown): a hung overlay would hang the tool call behind it. Requests
 * for other agents (subagents) fall through to `next()` unchanged.
 * @module @deepseek-ai/dsh-tui/chat/approval
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { TuiOverlaySession } from '../extension/types.ts'
import { ApprovalDialog } from '../components/dialogs.ts'
import type { ChannelNotice, ChatChannelDeps } from './channel.ts'

/** Collaborators the approval answerer needs from the chat channel. */
export interface ApprovalAnswererDeps extends ChatChannelDeps, ChannelNotice {
  /** The one agent whose asks this terminal answers. */
  agent: Agent
  /** Current row budget after reserving the editor. */
  questionMaxHeight(): number
  /** The pending tool call's one-line label, when its card is on screen. */
  pendingCallLabel(callId: CallId | undefined): string | undefined
}

/** Tool-approval controller for one chat channel. */
export interface ApprovalAnswerer {
  /** Settle the active and all queued asks `'cancelled'` (shutdown). */
  drain(): void
  /** Remove the waterfall listener. */
  unregister(): void
}

/**
 * Build the approval answerer for one chat channel.
 * @param deps - channel collaborators, the owned agent, and the overlay host.
 * @returns the controller used at shutdown to drain and unregister.
 */
export function createApprovalAnswerer(deps: ApprovalAnswererDeps): ApprovalAnswerer {
  const { ctx, agent, resolved, palette, overlayManager } = deps

  /** One claimed ask and how to settle it. */
  interface PendingApproval {
    request: ApprovalRequest
    resolve: (outcome: ApprovalOutcome) => void
    onAbort: () => void
    overlay: TuiOverlaySession | undefined
  }

  const queue: PendingApproval[] = []
  let active: PendingApproval | undefined

  const detach = (pending: PendingApproval): void => {
    pending.request.signal?.removeEventListener('abort', pending.onAbort)
  }

  /** Settle one ask, retiring it from the active slot if it holds it. */
  const settle = (pending: PendingApproval, outcome: ApprovalOutcome): void => {
    if (active === pending) active = undefined
    void pending.overlay?.close()
    pending.overlay = undefined
    detach(pending)
    pending.resolve(outcome)
  }

  /** The next-more-permissive preset name, when presets exist and one does. */
  const escalateTarget = (): { name: string; label: string } | undefined => {
    // Optional service: embedder bundles may mount the TUI without presets.
    const presets = ctx.get('permissionPresets') as {
      names(): readonly string[]
      current(events: readonly unknown[]): string
      optionOf(name: string): { description?: string } | undefined
    } | undefined
    if (presets === undefined) return undefined
    const names = presets.names()
    const index = names.indexOf(presets.current(agent.session.events))
    // `custom` (index -1) still offers the first escalation step.
    const next = index >= 0 ? index + 1 : 0
    if (next >= names.length) return undefined
    const name = names[next]
    if (name === undefined) return undefined
    return { name, label: `Always — switch to ${name}` }
  }

  const escalate = (name: string): void => {
    const presets = ctx.get('permissionPresets') as {
      set(session: unknown, name: string): unknown
    } | undefined
    if (presets === undefined) return
    try {
      presets.set(agent.session, name)
      deps.appendNotice(`Permission preset switched to ${name}.`)
    } catch (error) {
      deps.appendNotice(`Failed to switch permission preset: ${String(error)}`, 'error')
    }
  }

  const showNext = (): void => {
    if (active !== undefined || deps.isDisposed()) return
    const pending = queue.shift()
    if (pending === undefined) return
    active = pending
    const request = pending.request
    const target = escalateTarget()
    const session = overlayManager.open({
      ...request.signal === undefined ? {} : { signal: request.signal },
      create: () => new ApprovalDialog(
        request.toolName,
        request.reason,
        deps.pendingCallLabel(request.callId),
        target?.label,
        palette,
        (choice) => {
          if (choice === 'escalate' && target !== undefined) escalate(target.name)
          settle(pending, choice === 'reject' ? 'rejected' : 'allowed-once')
          showNext()
        },
        () => { /* settled by the choice handler */ },
      ),
      options: {
        width: Math.min(resolved.questionDialogWidth, 100),
        maxHeight: resolved.questionDialogMaxHeight,
      },
    }, 'inline')
    pending.overlay = session
    void session.closed.then((result) => {
      if (pending.overlay !== session) return
      pending.overlay = undefined
      // An overlay that died without a choice (owner disposed, render error)
      // fails closed; abort and shutdown settle through their own paths.
      if (result.reason !== 'error') return
      settle(pending, 'cancelled')
    })
    deps.requestRender()
  }

  const removeListener = ctx.on('approval/request', (request: ApprovalRequest, next) => {
    if (request.agent !== agent) return next()
    return new Promise<ApprovalOutcome>((resolveOutcome) => {
      const pending: PendingApproval = {
        request,
        resolve: resolveOutcome,
        onAbort: () => {
          if (active === pending) {
            settle(pending, 'cancelled')
            showNext()
            return
          }
          const index = queue.indexOf(pending)
          if (index >= 0) {
            queue.splice(index, 1)
            settle(pending, 'cancelled')
          }
        },
        overlay: undefined,
      }
      // One listener covers the ask through its whole life: queued or showing.
      request.signal?.addEventListener('abort', pending.onAbort, { once: true })
      queue.push(pending)
      showNext()
    })
  })

  return {
    drain(): void {
      if (active !== undefined) settle(active, 'cancelled')
      for (const pending of queue.splice(0)) settle(pending, 'cancelled')
    },
    unregister: removeListener,
  }
}
