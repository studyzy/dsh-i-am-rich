/**
 * Pure folds turning durable `llm/waste` records into the figures the status
 * bar shows: today's discarded tokens and the provider usage they came from.
 *
 * Every figure here is arithmetic over provider-reported usage. Nothing is
 * estimated, scaled, or invented: a discard the provider did not price
 * contributes no tokens and is counted separately as unpriced.
 */

import type { LlmWasteEventData } from './types.ts'

/** Token buckets accumulated from discarded duplicate requests. */
export interface WasteTotals {
  /** Discarded requests that reported provider usage. */
  readonly pricedCalls: number
  /** Discarded requests the provider did not price. */
  readonly unpricedCalls: number
  /** Uncached prompt tokens burned by discarded copies. */
  readonly inputTokens: number
  /** Completion tokens burned by discarded copies. */
  readonly outputTokens: number
  /** Cached prompt tokens read by discarded copies. */
  readonly cacheReadTokens: number
  /** Prompt tokens written to cache by discarded copies. */
  readonly cacheWriteTokens: number
}

/** Totals over no discarded requests. */
export const EMPTY_TOTALS: WasteTotals = {
  pricedCalls: 0,
  unpricedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** Total discarded tokens across every bucket. */
export function totalTokens(totals: WasteTotals): number {
  return totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
}

/**
 * Fold one discard into running totals.
 * @param totals - totals accumulated so far.
 * @param waste - the durable discard record to add.
 * @returns new totals including `waste`.
 */
export function addWaste(totals: WasteTotals, waste: LlmWasteEventData): WasteTotals {
  const usage = waste.usage
  if (usage === undefined) return { ...totals, unpricedCalls: totals.unpricedCalls + 1 }
  return {
    pricedCalls: totals.pricedCalls + 1,
    unpricedCalls: totals.unpricedCalls,
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    cacheReadTokens: totals.cacheReadTokens + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: totals.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
  }
}

/** A per-day bucket of discarded usage. */
export interface WasteDay extends WasteTotals {
  /** Local calendar day as `YYYY-MM-DD`. */
  readonly day: string
}

/**
 * The local calendar day of an instant.
 *
 * Local rather than UTC because "today" is what the person watching the status
 * bar means; a UTC boundary would reset the counter mid-evening for most users.
 * @param at - instant to place.
 * @returns the local calendar day as `YYYY-MM-DD`.
 */
export function localDay(at: Date): string {
  const year = String(at.getFullYear()).padStart(4, '0')
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The local calendar month of an instant, as the `YYYY-MM` prefix its days share.
 * @param at - instant to place.
 * @returns the local calendar month prefix.
 */
export function localMonth(at: Date): string {
  const year = String(at.getFullYear()).padStart(4, '0')
  const month = String(at.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/** Discarded-token totals for the three periods the status bar reports. */
export interface WastePeriods {
  /** Discarded tokens on the reader's current local day. */
  readonly today: number
  /** Discarded tokens in the reader's current local calendar month. */
  readonly month: number
  /** Discarded tokens across every recorded day. */
  readonly total: number
  /** Calls behind {@link today}. */
  readonly todayCalls: number
  /** Calls behind {@link month}. */
  readonly monthCalls: number
  /** Calls behind {@link total}. */
  readonly totalCalls: number
  /** Discards the provider never priced, across every recorded day. */
  readonly unpricedCalls: number
}

/**
 * Fold a per-day ledger into the today, this-month, and all-time figures.
 *
 * The ledger publishes days and no periods, because a period depends on the
 * reader's current date. Selecting the range here — against the caller's
 * `now` — keeps the durable projection clock-free while still reporting
 * calendar-correct periods.
 *
 * A day key that is not a well-formed `YYYY-MM-DD` still contributes to
 * {@link WastePeriods.total}, but can match neither the day nor the month
 * prefix, so malformed data can never inflate a period it does not belong to.
 * @param days - day-keyed buckets from the `wasteLedger` projection.
 * @param now - the reader's current instant, supplying today and this month.
 * @returns discarded-token totals for each period.
 */
export function sumPeriods(days: Record<string, WasteTotals>, now: Date): WastePeriods {
  const today = localDay(now)
  const month = localMonth(now)
  let todayTokens = 0
  let monthTokens = 0
  let totalTokens_ = 0
  let todayCalls = 0
  let monthCalls = 0
  let totalCalls = 0
  let unpricedCalls = 0

  for (const [day, totals] of Object.entries(days)) {
    const tokens = totalTokens(totals)
    const calls = totals.pricedCalls
    totalTokens_ += tokens
    totalCalls += calls
    unpricedCalls += totals.unpricedCalls
    if (day.startsWith(month)) {
      monthTokens += tokens
      monthCalls += calls
    }
    if (day === today) {
      todayTokens += tokens
      todayCalls += calls
    }
  }

  return {
    today: todayTokens,
    month: monthTokens,
    total: totalTokens_,
    todayCalls,
    monthCalls,
    totalCalls,
    unpricedCalls,
  }
}