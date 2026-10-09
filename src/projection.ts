/**
 * The `wasteLedger` session projection: durable discarded usage bucketed by
 * local calendar day, published to the Web client for the status bar.
 *
 * The projection is a pure fold over `llm/waste` records. The day is stamped
 * into each record when the Host appends it, so the fold and the wire view are
 * both clock-free: replay assigns exactly the day the live append did.
 *
 * The view deliberately publishes the whole per-day ledger and no period
 * totals. "Today" and "this month" depend on the reader's current date, which
 * the view cannot see, so range selection belongs to the client that owns the
 * clock. Keeping the arithmetic out of the fold is what lets replay reproduce
 * the live figures exactly.
 */

import { z as zod } from 'zod'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { addWaste, EMPTY_TOTALS, type WasteTotals } from './waste.ts'
import type { LlmWasteEventData } from './types.ts'

/** State of the day-bucketed waste ledger. */
export interface WasteLedgerState {
  /** Discarded-usage buckets, keyed by local calendar day. */
  readonly days: Record<string, WasteTotals>
}

/** Client-visible view of the ledger. */
export interface WasteLedgerView {
  /** Every day the session recorded discarded usage on, keyed `YYYY-MM-DD`. */
  readonly days: Record<string, WasteTotals>
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
const wasteLedgerStateSchema: zod.ZodType<WasteLedgerState> = zod.object({
  days: zod.record(zod.string(), totalsSchema),
})

/** Schema for the client-visible view. */
const wasteLedgerViewSchema: zod.ZodType<WasteLedgerView> = zod.object({
  days: zod.record(zod.string(), totalsSchema),
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Day-bucketed discarded-usage ledger folded from `llm/waste` records. */
    wasteLedger: WasteLedgerState
  }

  interface SessionProjectionMap {
    /** The ledger's client-visible view, read by the waste status bar. */
    wasteLedger: WasteLedgerView
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
 * The waste-ledger projection definition, registered by the Host plugin.
 *
 * Each `llm/waste` record carries the local calendar day it was appended on, so
 * the fold needs no clock and replay reproduces the live totals exactly.
 * @param key - projection key to register under.
 * @returns the projection definition for `ctx.sessionProjections.register`.
 */
export function createWasteLedgerProjection(
  key: 'wasteLedger' = 'wasteLedger',
): ProjectionDefinition<'wasteLedger', WasteLedgerState> & { wire: NonNullable<ProjectionDefinition<'wasteLedger', WasteLedgerState>['wire']> } {
  return {
    key,
    stateVersion: 1,
    stateSchema: wasteLedgerStateSchema,
    init: (_header: SessionHeader, _inherited: SessionLogOffset): WasteLedgerState => ({ days: {} }),
    apply: (state: WasteLedgerState, event: SessionEvent): WasteLedgerState => {
      if (!isWaste(event)) return state
      const day = event.data.day
      const current = state.days[day] ?? EMPTY_TOTALS
      return { days: { ...state.days, [day]: addWaste(current, event.data) } }
    },
    wire: {
      viewSchema: wasteLedgerViewSchema,
      view: (state: WasteLedgerState): WasteLedgerView => ({ days: state.days }),
    },
  }
}