/**
 * The `wasteToday` session projection: durable discarded usage bucketed by
 * local calendar day, published to the Web client for the status bar.
 *
 * The projection is a pure fold over `llm/waste` records. The day is stamped
 * into each record when the Host appends it, so the fold and the wire view are
 * both clock-free: replay assigns exactly the day the live append did.
 */

import { z as zod } from 'zod'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { addWaste, EMPTY_TOTALS, totalTokens, type WasteTotals } from './waste.ts'
import type { LlmWasteEventData } from './types.ts'

/** State of the day-bucketed waste ledger. */
export interface WasteTodayState {
  /** Discarded-usage buckets, keyed by local calendar day. */
  readonly days: Record<string, WasteTotals>
}

/** Client-visible view of the ledger. */
export interface WasteTodayView {
  /** Every day the session recorded discarded usage on. */
  readonly days: Record<string, WasteTotals>
  /** Discarded tokens on the most recent recorded day. */
  readonly latestDay: string | undefined
  /** Total discarded tokens on that day. */
  readonly latestTotal: number
}

/** Schema for one day's token buckets. */
const totalsSchema: zod.ZodType<WasteTotals> = zod.object({
  pricedCalls: zod.number().int().nonnegative(),
  unpricedCalls: zod.number().int().nonnegative(),
  inputTokens: zod.number().int().nonnegative(),
  outputTokens: zod.number().int().nonnegative(),
  cacheReadTokens: zod.number().int().nonnegative(),
  cacheWriteTokens: zod.number().int().nonnegative(),
})

/** Schema for the durable projection state. */
const wasteTodayStateSchema: zod.ZodType<WasteTodayState> = zod.object({
  days: zod.record(zod.string(), totalsSchema),
})

/** Schema for the client-visible view. */
const wasteTodayViewSchema: zod.ZodType<WasteTodayView> = zod.object({
  days: zod.record(zod.string(), totalsSchema),
  // Required-but-possibly-undefined mirrors WasteTodayView exactly; `.optional()`
  // would make the key omittable and stop matching the declared view.
  latestDay: zod.union([zod.string(), zod.undefined()]),
  latestTotal: zod.number().int().nonnegative(),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Day-bucketed discarded-usage ledger folded from `llm/waste` records. */
    wasteToday: WasteTodayState
  }

  interface SessionProjectionMap {
    /** The ledger's client-visible view, read by the waste status bar. */
    wasteToday: WasteTodayView
  }
}

/**
 * Whether an event is a discard record this projection folds.
 * @param event - any durable session event.
 * @returns true when the event carries discarded usage.
 */
function isWaste(event: SessionEvent): event is SessionEvent & { data: LlmWasteEventData } {
  return event.type === 'llm/waste'
}

/**
 * Read the folded view of one ledger state.
 * @param state - the folded ledger.
 * @returns the latest recorded day and its discarded-token total.
 */
function viewOf(state: WasteTodayState): WasteTodayView {
  // The latest day is the greatest `YYYY-MM-DD` key, which sorts
  // lexicographically in calendar order for the fixed-width format.
  let latestDay: string | undefined
  for (const day of Object.keys(state.days)) {
    if (latestDay === undefined || day > latestDay) latestDay = day
  }
  if (latestDay === undefined) {
    return { days: state.days, latestDay: undefined, latestTotal: 0 }
  }
  const totals = state.days[latestDay] ?? EMPTY_TOTALS
  return { days: state.days, latestDay, latestTotal: totalTokens(totals) }
}

/**
 * The waste-today projection definition, registered by the Host plugin.
 *
 * Each `llm/waste` record carries the local calendar day it was appended on, so
 * the fold needs no clock and replay reproduces the live totals exactly.
 * @param key - projection key to register under.
 * @returns the projection definition for `ctx.sessionProjections.register`.
 */
export function createWasteTodayProjection(
  key: 'wasteToday' = 'wasteToday',
): ProjectionDefinition<'wasteToday', WasteTodayState> & { wire: NonNullable<ProjectionDefinition<'wasteToday', WasteTodayState>['wire']> } {
  return {
    key,
    stateVersion: 1,
    stateSchema: wasteTodayStateSchema,
    init: (_header: SessionHeader, _inherited: SessionLogOffset): WasteTodayState => ({ days: {} }),
    apply: (state: WasteTodayState, event: SessionEvent): WasteTodayState => {
      if (!isWaste(event)) return state
      const day = event.data.day
      const current = state.days[day] ?? EMPTY_TOTALS
      return { days: { ...state.days, [day]: addWaste(current, event.data) } }
    },
    wire: {
      viewSchema: wasteTodayViewSchema,
      view: (state: WasteTodayState): WasteTodayView => viewOf(state),
    },
  }
}