import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import MemoryService from '../src/index.ts'
import { memoryRowSchema } from '../src/index.ts'
import type { MemoryId } from '../src/index.ts'

/**
 * Boot the real storage → json-backend → domain composition over one temp
 * root. Reopening with the same root simulates a process restart with the
 * durable store intact.
 */
async function harness(root: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(MemoryService, { maxTextBytes: 20, recallMaxChars: 120 })
  return { ctx, memory: ctx.memory }
}

/** Deterministic clock: pin Date.now() to a fixed time the test steps explicitly. */
function fakeClock(): { setNow(time: number): void; restore(): void } {
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => 9_000)
  return {
    setNow(time: number): void {
      spy.mockImplementation(() => time)
    },
    restore(): void {
      spy.mockRestore()
    },
  }
}

/** One fresh temp root per test; removed after. */
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-'))
  roots.push(root)
  return root
}

describe('memory service', () => {
  it('saves, lists, updates, and removes memories', async () => {
    const clock = fakeClock()
    const { memory } = await harness(await freshRoot())
    clock.setNow(1_000)
    const first = await memory.add('  likes lattes  ', [' Food ', 'food', ''])
    expect(first.text).toBe('likes lattes')
    // Tags normalize: trim, lowercase, dedupe, drop empties.
    expect(first.tags).toEqual(['food'])
    clock.setNow(2_000)
    const second = await memory.add('works on dsh')
    expect(second.tags).toEqual([])
    // list() keeps first-creation order.
    expect(memory.list().map(record => record.text)).toEqual(['likes lattes', 'works on dsh'])

    clock.setNow(3_000)
    const updated = await memory.update(first.id, { text: 'likes oat lattes', tags: ['coffee'] })
    expect(updated?.text).toBe('likes oat lattes')
    expect(updated?.tags).toEqual(['coffee'])
    expect(memory.list().map(record => record.text)).toEqual(['likes oat lattes', 'works on dsh'])
    // Updating only text keeps the tags; updating only tags keeps the text.
    clock.setNow(4_000)
    await memory.update(first.id, { text: 'loves oat lattes' })
    expect(memory.list()[0]?.tags).toEqual(['coffee'])
    clock.setNow(5_000)
    await memory.update(first.id, { tags: ['Coffee', 'AM'] })
    expect(memory.list()[0]?.text).toBe('loves oat lattes')
    expect(memory.list()[0]?.tags).toEqual(['coffee', 'am'])

    expect(await memory.remove(second.id as MemoryId)).toBe(true)
    expect(await memory.remove(second.id as MemoryId)).toBe(false)
    expect(memory.list().map(record => record.text)).toEqual(['loves oat lattes'])
    expect(await memory.update(second.id as MemoryId, { text: 'gone' })).toBeUndefined()
    clock.restore()
  })

  it('rejects blank and oversized text with descriptive errors', async () => {
    const { memory } = await harness(await freshRoot())
    await expect(memory.add('   ')).rejects.toThrow('memory text must contain a non-whitespace character')
    await expect(memory.add('x'.repeat(21))).rejects.toThrow('the limit is 20')
    const record = await memory.add('short')
    await expect(memory.update(record.id, { text: '  ' })).rejects.toThrow('non-whitespace')
  })

  it('rejects invalid deployment limits at the configuration boundary', async () => {
    const first = new Context()
    expect(() => new MemoryService(first, { maxTextBytes: 0, recallMaxChars: 100 })).toThrow('maxTextBytes')
    await first.fiber.dispose()
    const second = new Context()
    expect(() => new MemoryService(second, { maxTextBytes: 10, recallMaxChars: 1.5 })).toThrow('recallMaxChars')
    await second.fiber.dispose()
  })

  it('fails reads and writes before the domain initializes', async () => {
    const raw = new Context()
    await raw.plugin(Storage)
    await raw.plugin(StorageJson, { root: await freshRoot() })
    await raw.plugin(StorageDomain, { backend: 'json' })
    // Constructed directly, never started: the domain never opens.
    const memory = new MemoryService(raw, { maxTextBytes: 10, recallMaxChars: 100 })
    expect(() => memory.list()).toThrow('memory: durable domain is not initialized')
    await expect(memory.add('x')).rejects.toThrow('memory: durable domain is not initialized')
    await raw.fiber.dispose()
  })

  it('search matches text and tags case-insensitively, most recent first', async () => {
    const clock = fakeClock()
    const { memory } = await harness(await freshRoot())
    clock.setNow(1_000)
    await memory.add('user likes apple pie')
    clock.setNow(2_000)
    const macbook = await memory.add('owns a macbook', ['apple'])
    clock.setNow(3_000)
    await memory.add('prefers dark mode')
    expect(memory.search('APPLE').map(record => record.text))
      .toEqual(['owns a macbook', 'user likes apple pie'])
    expect(memory.search('dark')).toHaveLength(1)
    expect(memory.search('  ')).toEqual([])
    expect(memory.search('apple', 1).map(record => record.id)).toEqual([macbook.id])
    // Equal updatedAt falls to the stable id tiebreaker.
    clock.setNow(4_000)
    const tieA = await memory.add('tie alpha')
    const tieB = await memory.add('tie beta')
    const expected = [tieA, tieB].sort((l, r) => String(l.id).localeCompare(String(r.id)))
    expect(memory.search('tie ').map(record => record.id)).toEqual(expected.map(record => record.id))
    clock.restore()
  })

  it('recalledText renders most-recent-first within the character budget', async () => {
    const clock = fakeClock()
    const { memory } = await harness(await freshRoot())
    expect(memory.recalledText()).toBe('')
    clock.setNow(1_000)
    await memory.add('first fact')
    clock.setNow(2_000)
    await memory.add('second fact', ['tag'])
    const recalled = memory.recalledText()
    expect(recalled).toContain('Long-term memories about this user (most recent first):')
    expect(recalled).toContain('- second fact [#tag]')
    expect(recalled).toContain('- first fact')
    // A budget too small for even one memory renders nothing rather than a
    // bare header.
    expect(memory.recalledText(10)).toBe('')
    clock.restore()
  })

  it('recalledText degrades to empty once the domain is closed', async () => {
    const { ctx, memory } = await harness(await freshRoot())
    await memory.add('durable fact')
    expect(memory.recalledText()).toContain('durable fact')
    await ctx.fiber.dispose()
    expect(memory.recalledText()).toBe('')
  })

  it('memories survive a simulated restart over the same durable root', async () => {
    const root = await freshRoot()
    const first = await harness(root)
    await first.memory.add('survives restarts', ['durability'])
    await first.ctx.fiber.dispose()
    const second = await harness(root)
    expect(second.memory.list().map(record => record.text)).toEqual(['survives restarts'])
    await second.ctx.fiber.dispose()
  })
})

describe('durable row schema', () => {
  const validRow = {
    text: 'one fact',
    tags: ['food'],
    createdAt: 1_000,
    updatedAt: 1_000,
    version: '01923f7a-7dfe-7d7d-8bc4-3a1f2b5c9d01',
  }

  it('accepts a normalized row and rejects every documented invariant break', () => {
    expect(memoryRowSchema.safeParse(validRow).success).toBe(true)
    expect(memoryRowSchema.safeParse({ ...validRow, text: '   ' }).success).toBe(false)
    expect(memoryRowSchema.safeParse({ ...validRow, tags: ['Food'] }).success).toBe(false)
    expect(memoryRowSchema.safeParse({ ...validRow, tags: ['food', 'food'] }).success).toBe(false)
    expect(memoryRowSchema.safeParse({ ...validRow, updatedAt: 999 }).success).toBe(false)
  })
})

/** The `memory_save` tool's structured output. */
interface SaveOutcome {
  readonly id: string
  readonly text: string
  readonly tags: string[]
}

/** The `memory_search` tool's structured output. */
interface SearchOutcome {
  readonly query: string
  readonly results: readonly { id: string; text: string; tags: string[] }[]
  readonly total: number
}

describe('installed memory tools', () => {
  /** Boot the full tool surface over one harness context. */
  async function toolHarness() {
    const { ctx, memory } = await harness(await freshRoot())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    memory.installTools(ctx)
    // `installTools` drives an inject fiber; its registrations land once the
    // injected services resolve (a microtask chain), so let the queue drain.
    await new Promise(resolve => setTimeout(resolve, 25))
    const save = ctx.tools.get('memory_save')
    const search = ctx.tools.get('memory_search')
    if (save === undefined || search === undefined) throw new Error('memory tools did not register')
    return { ctx, memory, save, search }
  }

  it('registers both tools and the prompt sections', async () => {
    const { ctx, memory } = await toolHarness()
    expect(ctx.tools.get('memory_save')).toBeDefined()
    expect(ctx.tools.get('memory_search')).toBeDefined()
    // The recalled section's text callback reads the live store, and the tool
    // guidance section lands in the assembled prompt.
    await memory.add('section fact', ['sec'])
    const assembly = await ctx.systemPrompt.assemble({ scope: ctx })
    const sectionText = assembly.sections.map(section => section.text).join('\n')
    expect(sectionText).toContain('Long-term memories about this user')
    expect(sectionText).toContain('section fact [#sec]')
    expect(sectionText).toContain('call memory_search')
    // The tool schemas join the prompt's tool surface.
    expect(assembly.tools.map(tool => tool.name)).toContain('memory_save')
  })

  it('memory_save executes through the tool surface and normalizes input', async () => {
    const { memory, save } = await toolHarness()
    const saved = await save.execute({ text: '  tool fact  ', tags: ['X', 'x', ' '] }, {} as never) as SaveOutcome
    expect(saved.text).toBe('tool fact')
    expect(saved.tags).toEqual(['x'])
    expect(memory.list().map(record => record.text)).toEqual(['tool fact'])
    await expect(save.execute({ text: '   ' }, {} as never)).rejects.toThrow('non-whitespace')
    // presentCall titles the call from its arguments, with and without tags.
    expect(save.presentCall?.({ text: 'short' })).toEqual({ card: 'generic', title: 'Remember: short' })
    const long = save.presentCall?.({ text: `${'y'.repeat(70)}`, tags: ['t'] })
    expect(long).toEqual({ card: 'generic', title: `Remember: ${'y'.repeat(60)}…`, rawInput: { tags: ['t'] } })
    // The output render mirrors the saved text back, and the durable write
    // stays turn-exclusive.
    expect(save.isConcurrencySafe?.({ text: 'fact' })).toBe(false)
    expect(save.output.render({ text: 'tool fact' }, { id: '1', text: 'tool fact', tags: [] }))
      .toEqual([{ type: 'text', text: 'Saved to memory: tool fact' }])
  })

  it('memory_search executes with and without a limit, and renders both outcome shapes', async () => {
    const clock = fakeClock()
    const { memory, search } = await toolHarness()
    clock.setNow(1_000)
    await memory.add('likes oolong tea', ['drink'])
    clock.setNow(2_000)
    await memory.add('likes oolong cake')
    const full = await search.execute({ query: 'OOLONG' }, {} as never) as SearchOutcome
    expect(full.total).toBe(2)
    // Most recent first: the cake memory (t=2000) precedes the tea one.
    expect(full.results.map(record => record.text)).toEqual(['likes oolong cake', 'likes oolong tea'])
    const limited = await search.execute({ query: 'oolong', limit: 1 }, {} as never) as {
      results: unknown[]
      total: number
    }
    expect(limited.results).toHaveLength(1)
    expect(limited.total).toBe(2)
    await expect(search.execute({ query: '  ' }, {} as never)).rejects.toThrow('non-whitespace')
    expect(search.presentCall?.({ query: 'tea' })).toEqual({ card: 'generic', title: 'Search memory: tea' })
    const hitRender = search.output.render({ query: 'tea' }, {
      query: 'tea',
      results: [{ id: '1', text: 'likes oolong tea', tags: ['drink'] }],
      total: 1,
    })
    expect(hitRender).toEqual([{ type: 'text', text: '1. likes oolong tea [#drink]' }])
    const emptyRender = search.output.render({ query: 'zzz' }, { query: 'zzz', results: [], total: 0 })
    expect(emptyRender).toEqual([{ type: 'text', text: 'No memories matched "zzz".' }])
    // Pure reads may join a parallel group.
    expect(search.isConcurrencySafe?.({ query: 'fact' })).toBe(true)
    clock.restore()
  })
})
