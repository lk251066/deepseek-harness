/**
 * Durable long-term memory about the user. One storage-domain sidecar every
 * surface shares: the personal assistant's scoped `memory_save`/`memory_search`
 * tools, its auto-recalled prompt section, and the TUI's `/memories` browser
 * all read and write this one store.
 *
 * Memory is process-independent by design: rows live in the storage-domain
 * `memory` domain (the host's `storages` root), so facts survive restarts and
 * outlive any single conversation.
 * @module @deepseek-ai/dsh-memory/service
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { memoryDomainSpec } from './spec.ts'
import type { MemoryRow } from './spec.ts'
import type { Config, MemoryId, MemoryRecord, MemoryVersion } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

/** Default prompt-section budget when config omits `recallMaxChars`. */
export const DEFAULT_RECALL_MAX_CHARS = 4_000
/** Default per-memory text budget when config omits `maxTextBytes`. */
export const DEFAULT_MAX_TEXT_BYTES = 2_000
/** Default store-size ceiling when config omits `maxMemories`. */
export const DEFAULT_MAX_MEMORIES = 200
/** Default result ceiling for `memory_search` when the caller omits `limit`. */
export const DEFAULT_SEARCH_LIMIT = 20

/** Static guidance the memory tools carry into the prompt. */
const MEMORY_TOOL_GUIDANCE = [
  'You have long-term memory tools. Before answering questions about the user, call memory_search.',
  'When the user states a durable fact or preference, call memory_save once — one memory is one short,',
  'self-contained fact; do not re-save what the recalled-memory section already lists.',
].join(' ')

/** Validate one deployment-varying positive-integer limit. */
function resolvePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`memory: ${name} must be a positive safe integer, got ${String(value)}`)
  }
  return value
}

/** Normalize caller tags: trimmed, lowercased, empties and duplicates dropped. */
function normalizeTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  for (const tag of tags ?? []) {
    const normalized = tag.trim().toLowerCase()
    if (normalized !== '') seen.add(normalized)
  }
  return [...seen]
}

/** Copy and freeze one record before it crosses the service boundary. */
function snapshot(id: MemoryId, row: MemoryRow): MemoryRecord {
  return Object.freeze({
    id,
    text: row.text,
    tags: Object.freeze([...row.tags]),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}

/** Most-recently-updated first, id as the stable tiebreaker. */
function byRecent(left: MemoryRecord, right: MemoryRecord): number {
  return right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id))
}

/** Mint one new memory identity. */
function nextId(): MemoryId {
  return randomUUID() as MemoryId
}

/** Generate an opaque equality token for one material mutation. */
function nextVersion(): MemoryVersion {
  return randomUUID() as MemoryVersion
}

/** Format a memory's tags as the ` [#a #b]` suffix, or nothing when empty. */
function tagSuffix(tags: readonly string[]): string {
  return tags.length === 0 ? '' : ` [#${tags.join(' #')}]`
}

/** The `memory_save` tool's parsed input. */
interface SaveArgs {
  readonly text: string
  readonly tags?: readonly string[]
}

/** The `memory_search` tool's parsed input. */
interface SearchArgs {
  readonly query: string
  readonly limit?: number
}

/**
 * Long-term memory service: one durable domain, synchronous reads, write-chain
 * durability, and the assistant-scoped tool/section installation.
 */
export default class MemoryService extends Service {
  static inject = ['storageDomain']

  static Config: s<Config> = s.object({
    maxTextBytes: s.number().step(1).min(1).default(DEFAULT_MAX_TEXT_BYTES),
    recallMaxChars: s.number().step(1).min(1).default(DEFAULT_RECALL_MAX_CHARS),
    maxMemories: s.number().step(1).min(1).default(DEFAULT_MAX_MEMORIES),
  })

  private table: KvTable<MemoryId, MemoryRow> | undefined
  private readonly maxTextBytes: number
  private readonly recallMaxChars: number
  private readonly maxMemories: number

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - Deployment-varying text, recall, and store-size budgets.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'memory')
    this.maxTextBytes = resolvePositiveInteger(config.maxTextBytes, 'maxTextBytes')
    this.recallMaxChars = resolvePositiveInteger(config.recallMaxChars, 'recallMaxChars')
    this.maxMemories = resolvePositiveInteger(config.maxMemories, 'maxMemories')
  }

  /** Open and own the one memory domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    this.ctx.effect(() => async () => {
      await domain.close()
    }, 'memory.domainClose')
    this.table = domain.table('memories')
  }

  /** All memories in first-creation order. */
  list(): readonly MemoryRecord[] {
    const table = this.requireTable()
    const records: MemoryRecord[] = []
    for (const [id, row] of table.entries()) records.push(snapshot(id, row))
    return records
  }

  /**
   * Save one durable memory. Text is trimmed and validated; tags normalize.
   * @returns the stored record.
   */
  async add(text: string, tags?: readonly string[]): Promise<MemoryRecord> {
    const trimmed = this.validateText(text)
    const now = Date.now()
    const id = nextId()
    const row: MemoryRow = {
      text: trimmed,
      tags: normalizeTags(tags),
      createdAt: now,
      updatedAt: now,
      version: nextVersion(),
    }
    await this.requireTable().put(id, row)
    await this.evictToCeiling()
    return snapshot(id, row)
  }

  /**
   * Drop the oldest-created memories until the store fits its ceiling. An
   * over-ceiling store (a lowered config over old data) trims on the next
   * `add`, which is the only mutation path that can grow the store.
   */
  private async evictToCeiling(): Promise<void> {
    const table = this.requireTable()
    const records = this.list()
    for (const record of records.slice(0, Math.max(0, records.length - this.maxMemories))) {
      await table.delete(record.id)
    }
  }

  /**
   * Replace one memory's text and/or tags.
   * @returns the updated record, or `undefined` when the id is unknown.
   */
  async update(id: MemoryId, patch: { text?: string; tags?: readonly string[] }): Promise<MemoryRecord | undefined> {
    const table = this.requireTable()
    const current = table.get(id)
    if (current === undefined) return undefined
    const row: MemoryRow = {
      ...current,
      ...patch.text === undefined ? {} : { text: this.validateText(patch.text) },
      ...patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) },
      updatedAt: Date.now(),
      version: nextVersion(),
    }
    await table.put(id, row)
    return snapshot(id, row)
  }

  /**
   * Remove one memory.
   * @returns whether a memory with that id existed.
   */
  async remove(id: MemoryId): Promise<boolean> {
    return this.requireTable().delete(id)
  }

  /**
   * Keyword search across text and tags, case-insensitive substring.
   * @returns matches most-recently-updated first, at most `limit` (default 20).
   */
  search(query: string, limit?: number): readonly MemoryRecord[] {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return []
    const matches = this.list()
      .filter(record =>
        record.text.toLocaleLowerCase().includes(needle)
        || record.tags.some(tag => tag.includes(needle)))
      .sort(byRecent)
    return matches.slice(0, limit ?? DEFAULT_SEARCH_LIMIT)
  }

  /**
   * The auto-recalled prompt section's text: every memory, most recent first,
   * truncated to a character budget. A store that is uninitialized, closed, or
   * empty renders nothing — a prompt section must never break assembly.
   */
  recalledText(budgetChars: number = this.recallMaxChars): string {
    try {
      const records = [...this.list()].sort(byRecent)
      const header = 'Long-term memories about this user (most recent first):'
      const lines: string[] = [header]
      let used = header.length
      for (const record of records) {
        const line = `- ${record.text}${tagSuffix(record.tags)}`
        if (used + line.length + 1 > budgetChars) break
        lines.push(line)
        used += line.length + 1
      }
      return lines.length > 1 ? lines.join('\n') : ''
    } catch {
      return ''
    }
  }

  /**
   * Install the memory tools and prompt sections on ONE agent's scope: the
   * registrations live under that agent's context, so only agents set up this
   * way (the personal assistant) see them.
   */
  installTools(agentCtx: Context): void {
    agentCtx.inject(['tools', 'systemPrompt'], (toolCtx) => {
      toolCtx.systemPrompt.section({
        name: 'tool:memory',
        order: 101,
        text: MEMORY_TOOL_GUIDANCE,
      })
      toolCtx.systemPrompt.section({
        name: 'memory:recalled',
        order: 50,
        // Re-evaluated per assembly: the section always mirrors the store.
        text: () => this.recalledText(),
      })
      toolCtx.tools.register(defineTool({
        name: 'memory_save',
        description: 'Save a durable fact or preference about the user to long-term memory. One memory = one short, self-contained fact; save only what is worth remembering across conversations.',
        parameters: {
          text: {
            type: 'string',
            required: true,
            description: 'The fact or preference to remember, in one short self-contained sentence.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional lowercase topic tags for later lookup, e.g. ["food", "name"]. Omit when none.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              text: { type: 'string', required: true },
              tags: { type: 'array', items: { type: 'string' }, required: true },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: `Saved to memory: ${value.text}`,
          }],
        },
        presentCall: (args): GenericCallView => {
          const input = parseSaveArgs(args)
          return {
            card: 'generic',
            title: `Remember: ${input.text.slice(0, 60)}${input.text.length > 60 ? '…' : ''}`,
            ...input.tags === undefined ? {} : { rawInput: { tags: input.tags } },
          }
        },
        // Durable writes serialize on the domain's write chain; the call owns
        // its turn-exclusive slot until the put resolves.
        isConcurrencySafe: () => false,
        execute: async (args) => {
          const input = parseSaveArgs(args)
          const record = await this.add(input.text, input.tags)
          return { id: String(record.id), text: record.text, tags: [...record.tags] }
        },
      }))
      toolCtx.tools.register(defineTool({
        name: 'memory_search',
        description: 'Search long-term memories about the user by keyword (case-insensitive, matches text and tags). Search before answering questions about the user\'s preferences, background, or past arrangements.',
        parameters: {
          query: { type: 'string', required: true, description: 'Keyword or phrase to look for.' },
          limit: { type: 'number', description: `Maximum memories returned. Defaults to ${DEFAULT_SEARCH_LIMIT}.` },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', required: true },
              results: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    text: { type: 'string', required: true },
                    tags: { type: 'array', items: { type: 'string' }, required: true },
                  },
                },
              },
              total: { type: 'integer', required: true },
            },
          },
          render: (_args, value) => [{
            type: 'text',
            text: value.results.length === 0
              ? `No memories matched "${value.query}".`
              : value.results.map((record, index) =>
                `${index + 1}. ${record.text}${tagSuffix(record.tags)}`).join('\n'),
          }],
        },
        presentCall: (args): GenericCallView => ({
          card: 'generic',
          title: `Search memory: ${parseSearchArgs(args).query.slice(0, 60)}`,
        }),
        // Pure synchronous read over the authoritative in-memory state.
        isConcurrencySafe: () => true,
        execute: async (args) => {
          const input = parseSearchArgs(args)
          const query = input.query.trim()
          if (query === '') throw new Error('memory_search: query must contain a non-whitespace character')
          const all = this.search(query)
          const results = input.limit === undefined ? all : all.slice(0, input.limit)
          return {
            query,
            results: results.map(record => ({
              id: String(record.id),
              text: record.text,
              tags: [...record.tags],
            })),
            total: all.length,
          }
        },
      }))
    })
  }

  /** Trim and validate one memory text against the configured byte budget. */
  private validateText(text: string): string {
    const trimmed = text.trim()
    if (trimmed === '') throw new Error('memory text must contain a non-whitespace character')
    const bytes = Buffer.byteLength(trimmed, 'utf8')
    if (bytes > this.maxTextBytes) {
      throw new Error(`memory text is ${bytes} UTF-8 bytes; the limit is ${this.maxTextBytes}`)
    }
    return trimmed
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<MemoryId, MemoryRow> {
    if (this.table === undefined) {
      throw new Error('memory: durable domain is not initialized')
    }
    return this.table
  }
}

/** Parse and narrow the `memory_save` tool's already-validated arguments. */
function parseSaveArgs(args: unknown): SaveArgs {
  const value = args as SaveArgs
  return { text: String(value.text), ...value.tags === undefined ? {} : { tags: value.tags } }
}

/** Parse and narrow the `memory_search` tool's already-validated arguments. */
function parseSearchArgs(args: unknown): SearchArgs {
  const value = args as SearchArgs
  return {
    query: String(value.query),
    ...value.limit === undefined ? {} : { limit: value.limit },
  }
}
