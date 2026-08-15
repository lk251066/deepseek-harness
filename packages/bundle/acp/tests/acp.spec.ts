/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list that serves dsh-acp over the
 * base composition with stdout reserved for the protocol stream.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-acp bundle', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))

  function patchRows(): { id?: string; disabled?: unknown; config?: Record<string, unknown> }[] {
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('acp patch must parse to a patch list')
    return parsed as { id?: string; disabled?: unknown; config?: Record<string, unknown> }[]
  }

  it('declares the patch through the dsh.bundle.patch manifest field and depends on dsh-acp', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-acp']).toBe('workspace:^')
  })

  it('disables HMR so stdout stays a pure JSON-RPC stream', () => {
    const rows = patchRows()
    const hmr = rows.find(row => row.id === 'hmr')
    expect(hmr).toEqual({ id: 'hmr', disabled: true })
  })

  it('inserts exactly one row: the stdio ACP bridge with env-pinned routing', () => {
    const insert = patchRows().find(row => row.id === undefined && 'insert' in row) as unknown as {
      insert: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }
    expect(insert.insert).toHaveLength(1)
    const acp = insert.insert[0]
    expect(acp?.id).toBe('acp')
    expect(acp?.name).toBe('@deepseek-ai/dsh-acp')
    // The route is a deployment fact: env pins win, deepseek defaults stand in.
    expect(acp?.config?.provider).toEqual({ __jsExpr: "process.env.DSH_ACP_PROVIDER ?? 'deepseek-official'" })
    expect(acp?.config?.model).toEqual({ __jsExpr: "process.env.DSH_ACP_MODEL ?? 'deepseek-v4-flash'" })
  })
})
