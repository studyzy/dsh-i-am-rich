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