/**
 * The daily waste ledger: provider-reported usage folded into the figures the
 * status bar shows, with unpriced discards counted rather than invented.
 */

import { describe, expect, it } from 'vitest'
import { addWaste, EMPTY_TOTALS, localDay, totalTokens } from '../src/waste.ts'
import type { LlmWasteEventData, WasteId } from '../src/types.ts'

/** Build one discard record for the fold. */
function waste(overrides: Partial<LlmWasteEventData> = {}): LlmWasteEventData {
  return {
    wasteId: 'w1' as WasteId,
    provider: 'deepseek',
    model: 'deepseek-chat',
    outcome: 'discarded',
    day: '2026-01-05',
    ...overrides,
  }
}

describe('waste ledger', () => {
  it('starts empty', () => {
    expect(EMPTY_TOTALS).toEqual({
      pricedCalls: 0,
      unpricedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(totalTokens(EMPTY_TOTALS)).toBe(0)
  })

  it('sums every disjoint provider bucket', () => {
    const once = addWaste(EMPTY_TOTALS, waste({
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 7, totalTokens: 157 },
    }))
    const twice = addWaste(once, waste({
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
    }))

    expect(twice).toEqual({
      pricedCalls: 2,
      unpricedCalls: 0,
      inputTokens: 105,
      outputTokens: 21,
      cacheReadTokens: 30,
      cacheWriteTokens: 7,
    })
    expect(totalTokens(twice)).toBe(163)
  })

  it('counts an unpriced discard without claiming tokens for it', () => {
    const totals = addWaste(EMPTY_TOTALS, waste())

    expect(totals.unpricedCalls).toBe(1)
    expect(totalTokens(totals)).toBe(0)
  })

  it('counts a failed discard that the provider still priced', () => {
    const totals = addWaste(EMPTY_TOTALS, waste({
      outcome: 'failed',
      usage: { inputTokens: 40, outputTokens: 0, totalTokens: 40 },
    }))

    expect(totals.pricedCalls).toBe(1)
    expect(totalTokens(totals)).toBe(40)
  })

  it('does not mutate the totals it folds into', () => {
    const before = { ...EMPTY_TOTALS }
    addWaste(EMPTY_TOTALS, waste({ usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }))

    expect(EMPTY_TOTALS).toEqual(before)
  })

  it('places an instant on its local calendar day', () => {
    // Constructed from local parts, so the assertion holds in any timezone.
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
    expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31')
  })
})