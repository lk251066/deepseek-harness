/**
 * Durable storage-domain declaration for long-term user memory.
 * @module @deepseek-ai/dsh-memory/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryId, MemoryVersion } from './types.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Runtime schema for one opaque row version stored on disk. */
export const memoryVersionSchema = z.uuid()
  .transform(value => value as MemoryVersion)

/** One normalized lookup tag: non-empty, trimmed, lowercase. */
export const memoryTagSchema = z.string().min(1)
  .refine(tag => tag === tag.trim().toLowerCase(), {
    message: 'memory tag must be trimmed and lowercase',
  })

/** Runtime schema for one durable memory row. */
// Zod infers transformed branded fields structurally, so it cannot name the
// public interface even though every branded output is created by the service.
export const memoryRowSchema = z.object({
  text: z.string().refine(text => text.trim().length > 0, {
    message: 'memory text must contain a non-whitespace character',
  }),
  tags: z.array(memoryTagSchema),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
  version: memoryVersionSchema,
}).refine(row => row.updatedAt >= row.createdAt, {
  path: ['updatedAt'],
  message: 'memory updatedAt must not precede createdAt',
}).superRefine((row, ctx) => {
  const seen = new Set<string>()
  row.tags.forEach((tag, index) => {
    if (seen.has(tag)) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags', index],
        message: `duplicate memory tag '${tag}'`,
      })
    }
    seen.add(tag)
  })
}) as unknown as z.ZodType<MemoryRow>

/** Persisted row shape inferred from the durable schema's output. */
export interface MemoryRow {
  /** One short, self-contained fact or preference, stored trimmed. */
  readonly text: string
  /** Normalized lookup tags. */
  readonly tags: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly version: MemoryVersion
}

/** One durable memory row per id. */
export const memoryDomainSpec = defineDomain({
  name: 'memory',
  version: 0,
  tables: {
    memories: domainTable<MemoryId, MemoryRow>(memoryRowSchema),
  },
})
