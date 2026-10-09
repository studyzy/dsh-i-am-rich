/**
 * Pure folds turning durable discard records into the figures the status
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

/** A token count rendered at a magnitude the reader can take in at a glance. */
export interface Magnitude {
  /** The significant digits, already rounded for display. */
  readonly value: number
  /** The scale the digits are expressed in. */
  readonly unit: MagnitudeUnit
}

/** The scales a rendered magnitude can use. */
export type MagnitudeUnit = 'plain' | 'wan' | 'yi' | 'thousand' | 'million' | 'billion'

/** One scale's divisor and display unit, in ascending order of size. */
const SCALES: readonly { readonly unit: MagnitudeUnit; readonly factor: number; readonly decimals: number }[] = [
  { unit: 'plain', factor: 1, decimals: 0 },
  { unit: 'wan', factor: 1e4, decimals: 0 },
  { unit: 'yi', factor: 1e8, decimals: 2 },
]

/** The same scales under the English names the `en` dictionary shows. */
const EN_SCALES: readonly { readonly unit: MagnitudeUnit; readonly factor: number; readonly decimals: number }[] = [
  { unit: 'plain', factor: 1, decimals: 0 },
  { unit: 'thousand', factor: 1e3, decimals: 1 },
  { unit: 'million', factor: 1e6, decimals: 2 },
  { unit: 'billion', factor: 1e9, decimals: 2 },
]

/**
 * Scale a token count to the largest unit that keeps it readable.
 *
 * The Chinese scales are 万 and 亿 because those are the boundaries a Chinese
 * reader groups large numbers by; the English scales are K/M/B for the same
 * reason. Picking the largest applicable unit — rather than always emitting a
 * fixed pair — is what keeps `0亿` out of the display for a figure that is
 * plainly a few million.
 *
 * Rounding happens once, on the way out, and may carry a value up into the next
 * unit (`99,999,999` → `1.00亿`). That is deliberate: the alternative prints
 * `10000万`, which is a number no reader would say out loud. The trade is that a
 * rounded display can read as exactly `1.00亿` while the ledger holds slightly
 * less; the tooltip carries the exact figure for that reason.
 * @param tokens - the token count to scale.
 * @param scale - which scale family to use.
 * @returns the rounded digits and the unit they are expressed in.
 */
export function toMagnitude(tokens: number, scale: 'zh' | 'en' = 'zh'): Magnitude {
  const source = scale === 'en' ? EN_SCALES : SCALES
  const safe = Number.isFinite(tokens) && tokens > 0 ? tokens : 0
  let chosen = source[0]!
  for (const candidate of source) if (safe >= candidate.factor) chosen = candidate
  const value = safe / chosen.factor
  const rounded = Number(value.toFixed(chosen.decimals))
  // A rounded value that reaches the next scale is re-expressed in it, so the
  // bar never shows a unit the reader would have carried themselves.
  const next = source[source.indexOf(chosen) + 1]
  if (next !== undefined && rounded >= next.factor / chosen.factor) {
    return { value: Number((safe / next.factor).toFixed(next.decimals)), unit: next.unit }
  }
  return { value: rounded, unit: chosen.unit }
}
