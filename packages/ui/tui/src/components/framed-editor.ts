/**
 * The input box chrome: the Claude Code signature rounded frame around the
 * pi-tui editor (`╭─╮ │ … │ ╰─╯`). The editor stays the TUI focus target and
 * keeps rendering its own rows (prompt prefix, fake cursor, autocomplete
 * dropdown); this wrapper only borrows those rows at `width - 4` and re-frames
 * them. The editor's zero-width hardware-cursor marker survives untouched —
 * the TUI locates it by scanning whole rendered lines and measuring the width
 * of the text before it, so the two border columns shift the reported cursor
 * column exactly with the frame.
 * @module @deepseek-ai/dsh-tui/components/framed-editor
 */

import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { Editor } from '@earendil-works/pi-tui'

/** Below this width the frame's borders crowd out the text: render unframed. */
const MIN_FRAMED_WIDTH = 12
/** Left (`│ `) plus right (` │`) frame columns. */
const FRAME_COLUMNS = 4

/** Right-pad one rendered row to `width` columns, ANSI-aware. */
function padToWidth(line: string, width: number): string {
  const shortfall = width - visibleWidth(line)
  return shortfall > 0 ? `${line}${' '.repeat(shortfall)}` : line
}

/**
 * A rounded-corner frame around the input editor, drawn in the editor's own
 * border tone (dim while idle, accent while the agent runs — the editor
 * already switches `borderColor` on status). Pure delegation: focus, input
 * handling, and the hardware cursor all keep belonging to the wrapped editor.
 */
export class FramedEditorComponent implements Component {
  constructor(private readonly editor: Editor) {}

  invalidate(): void {
    this.editor.invalidate()
  }

  render(width: number): string[] {
    if (width < MIN_FRAMED_WIDTH) return this.editor.render(width)
    const border = this.editor.borderColor
    const innerWidth = width - FRAME_COLUMNS
    const horizontal = '─'.repeat(width - 2)
    const rows = this.editor.render(innerWidth)
    return [
      border(`╭${horizontal}╮`),
      ...rows.map(row => `${border('│')} ${padToWidth(row, innerWidth)} ${border('│')}`),
      border(`╰${horizontal}╯`),
    ]
  }
}
