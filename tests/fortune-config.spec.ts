/**
 * Persisting the fortune tier through the harness config editor.
 *
 * The writer's contract is narrow on purpose: it must change **only** `fortune`
 * in the plugin's own config, and it must fail loudly when the harness cannot
 * persist at all, so the picker can report "not saved" rather than pretending.
 */

import { describe, expect, it, vi } from 'vitest'
import { asFortuneWriterContext, createFortuneWriter, currentFortune } from '../src/fortune-config.ts'

/** A context double whose editor records what it was asked to write. */
function contextWith(editor: unknown, entry: unknown = { id: 'i-am-rich' }) {
  return {
    fiber: { entry },
    get: (name: string) => (name === 'configEditor' ? editor : undefined),
  }
}

/** A context double with no Loader entry, as an unprofiled harness has. */
function contextWithoutEntry(editor: unknown) {
  return { fiber: {}, get: (name: string) => (name === 'configEditor' ? editor : undefined) }
}

describe('fortune writer', () => {
  it('persists the chosen tier through the config editor', async () => {
    const edit = vi.fn(async () => {})
    const ctx = contextWith({ edit })

    await createFortuneWriter(ctx)('billionaire')

    expect(edit).toHaveBeenCalledTimes(1)
    expect(edit.mock.calls[0]?.[0]).toEqual({ id: 'i-am-rich' })
  })

  it('changes only the fortune field, preserving the rest of the config', async () => {
    const edit = vi.fn(async () => {})
    const ctx = contextWith({ edit })

    await createFortuneWriter(ctx)('billionaire')
    const change = edit.mock.calls[0]?.[1] as (c: Record<string, unknown>, i: Record<string, unknown>) => Record<string, unknown>
    const next = change({ enabled: true, discardedCopies: 3, fortune: 'millionaire' }, {})

    // Replacing the whole object would silently reset any other field the user
    // had set — including `discardedCopies`, which is real money.
    expect(next).toEqual({ enabled: true, discardedCopies: 3, fortune: 'billionaire' })
  })

  it('rejects when the plugin was not loaded from a profile entry', async () => {
    const edit = vi.fn(async () => {})

    // No fiber entry, so nothing to edit; promising a save here would be a lie.
    await expect(createFortuneWriter(contextWithoutEntry(edit))('billionaire')).rejects.toThrow(/profile entry/u)
    expect(edit).not.toHaveBeenCalled()
  })

  it('rejects when the harness has no config editor', async () => {
    await expect(createFortuneWriter(contextWith(undefined))('billionaire')).rejects.toThrow(/configEditor/u)
  })

  it('propagates an editor failure rather than swallowing it', async () => {
    const ctx = contextWith({ edit: async () => { throw new Error('locked') } })

    // The route turns this into a 500; swallowing it would report a save that
    // did not happen.
    await expect(createFortuneWriter(ctx)('billionaire')).rejects.toThrow('locked')
  })

  it('reads the tier currently in effect from the resolved config', () => {
    expect(currentFortune({ fortune: 'millionaire' })).toBe('millionaire')
    expect(currentFortune({ fortune: 'billionaire' })).toBe('billionaire')
  })

  it('views a plain context as a fortune-writer context', () => {
    const ctx = { fiber: { entry: { id: 'x' } }, get: () => undefined }
    expect(asFortuneWriterContext(ctx)).toBe(ctx)
  })
})