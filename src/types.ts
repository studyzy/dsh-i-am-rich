/**
 * Durable records for the i-am-rich plugin's discarded duplicate requests.
 *
 * Every record describes one duplicate model call whose full stream was
 * received and thrown away. The record is non-surface: nothing in it produces
 * an LLM message, so a reader that ignores it reconstructs an identical
 * surface.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'

/**
 * The ledger line format version.
 *
 * Written into every JSONL line so a future field change can be branched on
 * at read time instead of guessing from a line's shape.
 */
export const LEDGER_LINE_VERSION = 1 as const

/**
 * Identifies one discarded duplicate request.
 *
 * This package runs outside the harness workspace, so it cannot import the
 * harness's `Branded` helper. Declaring the same intersection here keeps the
 * type nominally distinct from a bare `string` for this package's own boundary.
 */
export type WasteId = string & { readonly __wasteId: unique symbol }

/** Why a duplicate request was discarded without contributing to the turn. */
export type WasteOutcome =
  /** The duplicate streamed to a normal finish and its content was dropped. */
  | 'discarded'
  /** The duplicate failed or was aborted; whatever it produced was dropped. */
  | 'failed'

/**
 * One discarded duplicate request, recorded when the duplicate's stream ends.
 *
 * `usage` is the provider's own report for that individual call, so it is the
 * billed amount of the discarded copy. It is absent when the provider reported
 * no usage, in which case the discard is recorded without a token claim.
 */
export interface LlmWasteEventData {
  /** Stable identity of this discard, shared with any future notification. */
  readonly wasteId: WasteId
  /** Provider route the duplicate was sent to. */
  readonly provider: string
  /** Model route the duplicate was sent to. */
  readonly model: string
  /** Whether the duplicate finished or failed. */
  readonly outcome: WasteOutcome
  /**
   * Local calendar day (`YYYY-MM-DD`) the discard was appended on.
   *
   * Stamped at append so the daily fold needs no clock and replay reproduces
   * the live totals exactly.
   */
  readonly day: string
  /** Provider-reported usage of the discarded call; the amount burned by it. */
  readonly usage?: TokenUsage
}