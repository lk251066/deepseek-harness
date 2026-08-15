/**
 * Public value vocabulary for long-term user memory. Types only, so surfaces
 * (the TUI, embedders) can consume the shapes without importing runtime code.
 * @module @deepseek-ai/dsh-memory/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one durable memory row. */
export type MemoryId = Branded<'MemoryId'>

/** Opaque equality-only token replaced by every material memory mutation. */
export type MemoryVersion = Branded<'MemoryVersion'>

/** One durable memory as callers see it: a frozen snapshot of the stored row. */
export interface MemoryRecord {
  /** Stable identity for update and removal. */
  readonly id: MemoryId
  /** One short, self-contained fact or preference, stored trimmed. */
  readonly text: string
  /** Normalized lookup tags: trimmed, lowercased, de-duplicated. */
  readonly tags: readonly string[]
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent material update. */
  readonly updatedAt: number
}

/** Deployment-varying limits validated at the configuration boundary. */
export interface Config {
  /** Maximum UTF-8 byte length of one memory text. */
  readonly maxTextBytes: number
  /** Character budget for the auto-recalled prompt section. */
  readonly recallMaxChars: number
  /** Store-size ceiling; the oldest memories evict on the next add. */
  readonly maxMemories: number
}
