/**
 * The working status line above the input box (the Claude Code "✻ Thinking…"
 * row): a braille spinner frame, what the agent is actually doing (the newest
 * pending tool card's verb label, or `Thinking…` between tools), and the
 * elapsed wall time. Renders nothing while idle.
 * @module @deepseek-ai/dsh-tui/components/working-line
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { formatStatusDuration } from '../chat/timing.ts'
import type { Palette } from './theme.ts'

/** What the line says while the model streams with no tool in flight. */
const THINKING_LABEL = 'Thinking…'

/** One dim status row while the agent runs; nothing while idle. */
export class WorkingLineComponent implements Component {
  private running = false
  private startedAt: number | undefined
  private activity: string | undefined
  private frame: string | undefined

  constructor(
    private readonly palette: Palette,
    private readonly now: () => number,
  ) {}

  /**
   * Drive the whole line in one call (each spinner tick).
   * @param running - Whether the agent is mid-turn.
   * @param startedAt - Turn start in epoch ms (clamps elapsed at 0 until set).
   * @param activity - Newest pending tool verb label; `undefined` = thinking.
   * @param frame - Braille spinner frame, or `undefined` before the first tick.
   */
  update(running: boolean, startedAt: number | undefined, activity: string | undefined, frame: string | undefined): void {
    this.running = running
    this.startedAt = startedAt
    this.activity = activity
    this.frame = frame
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.running) return []
    const glyph = this.frame ?? '⠋'
    const label = this.activity ?? THINKING_LABEL
    const startedAt = this.startedAt ?? this.now()
    const elapsed = formatStatusDuration(Math.max(0, this.now() - startedAt))
    return [this.palette.dim(truncateToWidth(`${glyph} ${label} · ${elapsed}`, width, ''))]
  }
}
