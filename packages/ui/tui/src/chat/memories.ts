/**
 * The `/memories` browser's rows: one durable-memory store rendered as a
 * read-only insight panel. Pure formatting — the command handler reads the
 * optional `ctx.memory` service and degrades to a notice when absent.
 * @module @deepseek-ai/dsh-tui/chat/memories
 */

import type { MemoryRecord } from '@deepseek-ai/dsh-memory'

/** Rows shown when the memory plugin is not mounted in this composition. */
export const MEMORY_UNAVAILABLE_LINES = [
  'Memory is not available in this composition.',
  'Mount @deepseek-ai/dsh-memory (the tui profile does) to give the assistant long-term memory.',
]

/**
 * Render the memory panel's rows: a count header, then one row per memory in
 * first-creation order — `• text [#tags] (updated <date>)`, text truncated so
 * a row stays one line.
 * @param records - the store's current records.
 * @returns the panel rows.
 */
export function memoriesLines(records: readonly MemoryRecord[]): string[] {
  if (records.length === 0) {
    return ['No long-term memories yet.', 'Tell the assistant something durable — it saves with memory_save.']
  }
  const rows = records.map((record) => {
    const tags = record.tags.length === 0 ? '' : ` [#${record.tags.join(' #')}]`
    const text = record.text.length > 64 ? `${record.text.slice(0, 64)}…` : record.text
    const updated = new Date(record.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
    return `• ${text}${tags} (updated ${updated})`
  })
  return [`${records.length} memor${records.length === 1 ? 'y' : 'ies'}`, '', ...rows]
}
