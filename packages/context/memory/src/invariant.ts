/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory`.
 * @module @deepseek-ai/dsh-memory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory'

/** Cordis companion plugin name. */
export const name = 'memory-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the memory service is the single typed writer, the
 * domain schema validates every row on reopen (non-blank text, normalized
 * unique tags, updatedAt not before createdAt), and the storage domain's own
 * write chain serializes mutations, so no second authority exists to check.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['memory'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
