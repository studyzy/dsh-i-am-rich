/**
 * The daily waste ledger: provider-reported usage folded into the figures the
 * status bar shows, with unpriced discards counted rather than invented.
 */

import { describe, expect, it } from 'vitest'
import { addWaste, EMPTY_TOTALS, localDay, localMonth, sumPeriods, totalTokens, type WasteTotals } from '../src/waste.ts'
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

  it('places an instant in its local calendar month', () => {
    expect(localMonth(new Date(2026, 0, 5, 23, 30))).toBe('2026-01')
    expect(localMonth(new Date(2026, 11, 31, 0, 0))).toBe('2026-12')
  })
})

/** Build a day bucket with the given token and call counts. */
function bucket(inputTokens: number, pricedCalls = 1, unpricedCalls = 0): WasteTotals {
  return {
    pricedCalls,
    unpricedCalls,
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

describe('period totals', () => {
  const NOW = new Date(2026, 0, 15, 12, 0)

  it('reports zero for every period with no recorded days', () => {
    expect(sumPeriods({}, NOW)).toEqual({
      today: 0,
      month: 0,
      total: 0,
      todayCalls: 0,
      monthCalls: 0,
      totalCalls: 0,
      unpricedCalls: 0,
    })
  })

  it('separates today from the rest of the month and from all time', () => {
    const periods = sumPeriods({
      '2026-01-15': bucket(100), // today
      '2026-01-02': bucket(200), // earlier this month
      '2025-12-20': bucket(400), // a previous month
    }, NOW)

    expect(periods.today).toBe(100)
    expect(periods.month).toBe(300)
    expect(periods.total).toBe(700)
  })

  it('counts calls alongside tokens for each period', () => {
    const periods = sumPeriods({
      '2026-01-15': bucket(100, 2),
      '2026-01-02': bucket(200, 3),
      '2025-12-20': bucket(400, 4),
    }, NOW)

    expect(periods.todayCalls).toBe(2)
    expect(periods.monthCalls).toBe(5)
    expect(periods.totalCalls).toBe(9)
  })

  it('excludes an adjacent month on both sides of the boundary', () => {
    const periods = sumPeriods({
      '2025-12-31': bucket(1000),
      '2026-01-01': bucket(10),
      '2026-02-01': bucket(2000),
    }, NOW)

    expect(periods.month).toBe(10)
    expect(periods.total).toBe(3010)
  })

  it('does not let a same-day-looking day from another year count as today', () => {
    const periods = sumPeriods({
      '2025-01-15': bucket(500),
      '2026-01-15': bucket(25),
    }, NOW)

    expect(periods.today).toBe(25)
    expect(periods.total).toBe(525)
  })

  it('accumulates unpriced calls across every day', () => {
    const periods = sumPeriods({
      '2026-01-15': bucket(0, 0, 2),
      '2025-06-01': bucket(0, 0, 3),
    }, NOW)

    expect(periods.unpricedCalls).toBe(5)
    expect(periods.total).toBe(0)
  })

  it('counts a malformed day key only toward the total', () => {
    // A key that is neither a valid day nor month must not inflate a period.
    const periods = sumPeriods({
      'not-a-day': bucket(900),
      '2026-01-15': bucket(100),
    }, NOW)

    expect(periods.today).toBe(100)
    expect(periods.month).toBe(100)
    expect(periods.total).toBe(1000)
  })
})