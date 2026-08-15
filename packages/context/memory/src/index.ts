/**
 * Durable long-term memory about the user: one storage-domain sidecar shared
 * by the personal assistant's scoped tools, its auto-recalled prompt section,
 * and any browsing surface. Registers `ctx.memory`.
 * @module @deepseek-ai/dsh-memory
 */

export { default } from './service.ts'
export { DEFAULT_MAX_TEXT_BYTES, DEFAULT_MAX_MEMORIES, DEFAULT_RECALL_MAX_CHARS, DEFAULT_SEARCH_LIMIT } from './service.ts'
export type { Config, MemoryId, MemoryRecord, MemoryVersion } from './types.ts'
export { memoryDomainSpec, memoryRowSchema, memoryTagSchema, memoryVersionSchema } from './spec.ts'
export type { MemoryRow } from './spec.ts'
