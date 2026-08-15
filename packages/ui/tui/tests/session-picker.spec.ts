import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPickerDialog, type SessionChoice } from '../src/components/dialogs.ts'
import { createPalette } from '../src/components/theme.ts'

/** Color-disabled palette: rows render plain text, so labels assert exactly. */
const plain = createPalette(false, 'dark')

function choices(): SessionChoice[] {
  return [
    { sessionId: SessionId('main'), label: 'main', detail: 'idle · 2 turns', active: true },
    { sessionId: SessionId('session-a'), label: 'session-a', detail: 'running · 1 turn', active: false },
    { sessionId: SessionId('session-b'), label: 'Fix the login bug', detail: 'session-b · idle', active: false },
  ]
}

function picker(
  rows: readonly SessionChoice[] = choices(),
): { dialog: SessionPickerDialog; choose: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const choose = vi.fn()
  const close = vi.fn()
  return { dialog: new SessionPickerDialog(rows, plain, choose, close), choose, close }
}

describe('SessionPickerDialog', () => {
  it('renders every row numbered, marks the active one, and shows key hints', () => {
    const rendered = picker().dialog.render(72).join('\n')
    expect(rendered).toContain('Sessions')
    expect(rendered).toContain('1. ● main')
    expect(rendered).toContain('2.')
    expect(rendered).toContain('session-a running · 1 turn')
    expect(rendered).toContain('3.')
    expect(rendered).toContain('Fix the login bug')
    expect(rendered).toContain('↑/↓ move • Enter or 1-9 switch • Esc close')
  })

  it('a digit key chooses that rendered row directly', () => {
    const { dialog, choose } = picker()
    dialog.render(72)
    dialog.handleInput('3')
    expect(choose).toHaveBeenCalledTimes(1)
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SessionId('session-b') }))
  })

  it('a digit beyond the row count is ignored', () => {
    const { dialog, choose } = picker()
    dialog.render(72)
    dialog.handleInput('9')
    expect(choose).not.toHaveBeenCalled()
  })

  it('Enter chooses the highlighted row; arrows wrap around', () => {
    const { dialog, choose } = picker()
    dialog.render(72)
    dialog.handleInput('\x1b[A') // up from row 0 wraps to the last row
    dialog.handleInput('\r')
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SessionId('session-b') }))
  })

  it('down then Enter chooses the second row', () => {
    const { dialog, choose } = picker()
    dialog.render(72)
    dialog.handleInput('\x1b[B')
    dialog.handleInput('\r')
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SessionId('session-a') }))
  })

  it('Escape and Ctrl+C close without choosing', () => {
    const first = picker()
    first.dialog.handleInput('\x1b')
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(first.choose).not.toHaveBeenCalled()
    const second = picker()
    second.dialog.handleInput('\x03')
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(second.choose).not.toHaveBeenCalled()
  })

  it('choosing the active row still reports it (the host no-ops the switch)', () => {
    const { dialog, choose } = picker()
    dialog.render(72)
    dialog.handleInput('1')
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ active: true }))
  })

  it('an empty set renders the alone state instead of an empty list', () => {
    const { dialog } = picker([])
    const rendered = dialog.render(72).join('\n')
    expect(rendered).toContain('No live sessions besides this one.')
    expect(rendered).toContain('Ctrl+N or /new starts one.')
  })

  it('the highlighted row carries the selection caret', () => {
    const { dialog } = picker()
    const initial = dialog.render(72).join('\n')
    expect(initial).toContain('❯')
    dialog.handleInput('\x1b[B')
    const moved = dialog.render(72).join('\n')
    // Both renders have exactly one caret; after moving, the second row owns it.
    expect(initial.match(/❯/gu)?.length).toBe(1)
    const caretRow = moved.split('\n').findIndex(line => line.includes('❯'))
    const secondRow = moved.split('\n').findIndex(line => line.includes('2.'))
    expect(caretRow).toBe(secondRow)
  })
})
