import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { createTuiTestHarness, disposeTuiTestHarness, type TuiHarness } from './harness.ts'
import { forkCut } from '../src/chat/fork.ts'

/** Minimal terminal recorder: appends every write, replays input sends. */
class FakeTerminal implements Terminal {
  columns = 88
  rows = 32
  kittyProtocolActive = false
  output = ''
  title = ''
  progress = false
  started = 0
  stopped = 0
  cursorVisible = true
  drainInput = () => Promise.resolve()
  private onInput: (data: string) => void = () => {}
  private onResize: () => void = () => {}
  start(onInput: (data: string) => void, onResize: () => void): void {
    this.started += 1
    this.onInput = onInput
    this.onResize = onResize
  }
  stop(): void { this.stopped += 1 }
  write(data: string): void { this.output += data }
  send(data: string): void { this.onInput(data) }
  moveBy(): void { this.output += '[move]' }
  hideCursor(): void { this.output += '[hide]' }
  showCursor(): void { this.output += '[show]' }
  clearLine(): void { this.output += '[clear-line]' }
  clearFromCursor(): void { this.output += '[clear-from]' }
  clearScreen(): void { this.output += '[clear-screen]' }
  setTitle(title: string): void { this.title = title }
  setProgress(active: boolean): void { this.progress = active }
}

async function tick(ms = 25): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function setup(): Promise<TuiHarness<FakeTerminal, (code: number) => void>> {
  const terminal = new FakeTerminal()
  const result = await createTuiTestHarness(terminal, vi.fn(), {})
  await tick()
  return result
}

/** Fire one approval ask down the waterfall the way ApprovalService would. */
function ask(result: TuiHarness<FakeTerminal, (code: number) => void>, options: {
  toolName?: string
  callId?: string
  signal?: AbortSignal
  agent?: 'owned' | 'other'
} = {}): Promise<ApprovalOutcome> {
  const otherAgent = { ...result.agent, id: 'other-agent' as never }
  return result.ctx.waterfall(
    'approval/request',
    {
      agent: options.agent === 'other' ? otherAgent : result.agent,
      toolName: options.toolName ?? 'bash',
      ...options.callId !== undefined ? { callId: options.callId as never } : {},
      ...options.signal !== undefined ? { signal: options.signal } : {},
    } as never,
    () => Promise.resolve<ApprovalOutcome>('unavailable'),
  ) as Promise<ApprovalOutcome>
}

describe('approval overlay', () => {
  it('shows a takeover and resolves allowed-once on Enter', async () => {
    const result = await setup()
    const outcome = ask(result)
    await tick()
    expect(result.terminal.output).toContain('needs your approval')
    expect(result.terminal.output).toContain('Allow once')
    // Enter on the pre-selected first option.
    result.terminal.send('\r')
    await expect(outcome).resolves.toBe('allowed-once')
    await disposeTuiTestHarness(result)
  })

  it('rejects on Escape', async () => {
    const result = await setup()
    const outcome = ask(result)
    await tick()
    result.terminal.send('\x1b')
    await expect(outcome).resolves.toBe('rejected')
    await disposeTuiTestHarness(result)
  })

  it('settles cancelled when the ask is aborted', async () => {
    const result = await setup()
    const controller = new AbortController()
    const outcome = ask(result, { signal: controller.signal })
    await tick()
    controller.abort()
    await expect(outcome).resolves.toBe('cancelled')
    await disposeTuiTestHarness(result)
  })

  it('falls through to next() for another agent, failing closed', async () => {
    const result = await setup()
    await expect(ask(result, { agent: 'other' })).resolves.toBe('unavailable')
    // The overlay never opened for the foreign agent.
    expect(result.terminal.output).not.toContain('needs your approval')
    await disposeTuiTestHarness(result)
  })
})

describe('fork boundary', () => {
  const ev = (type: string, extra: Record<string, unknown> = {}): { type: string } & Record<string, unknown> =>
    ({ type, ...extra })

  it('cuts after the last turn/end, absorbing trailing out-of-band events', () => {
    const events = [
      ev('turn/start'), ev('user/message'), ev('turn/end'),
      ev('session/title'), ev('approval/asked'), ev('approval/decided'),
    ] as never
    expect(forkCut(events)).toBe(6)
  })

  it('anchors at a seq and stops at the next turn/start', () => {
    const events = [
      ev('turn/start'), ev('turn/end'),
      ev('session/title'),
      ev('turn/start'), ev('user/message'), ev('turn/end'),
    ] as never
    // Anchored at the first turn's end: the seed absorbs the trailing title
    // and stops before the next turn begins.
    expect(forkCut(events, 1)).toBe(3)
    // Without an anchor, the fork takes the LAST completed turn.
    expect(forkCut(events)).toBe(6)
  })

  it('returns undefined without a completed turn', () => {
    expect(forkCut([ev('turn/start'), ev('user/message')] as never)).toBeUndefined()
    expect(forkCut([] as never)).toBeUndefined()
  })
})
