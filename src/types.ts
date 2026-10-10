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
 * How lavishly each request is duplicated.
 *
 * The tiers are ordered by how much they spend, not by any provider's pricing:
 *
 * - `millionaire` sends the request twice **verbatim**. The duplicate shares
 *   the original's prompt prefix, so on a warm cache it is billed at the cheap
 *   cache-read rate — the duplicate is a real call, but a discounted one.
 * - `billionaire` stamps a fresh {@link billionaireStamp} line into the head of
 *   the duplicate's system prompt, which changes the prompt prefix. The
 *   provider therefore cannot serve it from the original's cache: it is a
 *   cache **miss**, billed as a fresh cache write rather than a cache read,
 *   which is what makes this tier genuinely expensive instead of merely
 *   redundant.
 *
 * The names are the joke; the mechanism is the cache boundary.
 */
export type FortuneTier =
  /** Two identical copies; the duplicate usually lands on the warm cache. */
  | 'millionaire'
  /** The duplicate carries a different prefix, forcing a cache miss. */
  | 'billionaire'

/**
 * Every fortune tier, in ascending order of spend.
 *
 * Exported so the config schema, the client's radio group, and the tests all
 * enumerate one list rather than each restating the union.
 */
export const FORTUNE_TIERS: readonly FortuneTier[] = ['millionaire', 'billionaire']

/**
 * Build the timestamp line the `billionaire` tier writes into the system prompt.
 *
 * It has one job: make the duplicate's prompt prefix differ from the original's
 * so the provider's prompt cache cannot serve it. A per-call timestamp does
 * that by construction — the value is different on every dispatch, so no two
 * duplicates can ever share a cache entry, and it differs from the original's
 * prompt just as reliably.
 *
 * It goes in the **head of the existing system message** rather than in an
 * inserted message of its own. The previous shape prepended a whole extra
 * message, which meant rebuilding the entire `messages` array on every request
 * — an array that carries the full conversation, typically hundreds of
 * thousands of tokens by the time a session is long. Rewriting one text block
 * leaves the message count and every other message untouched.
 *
 * The text is an internal constant rather than a locale key: it is sent to the
 * model, never rendered, so translating it would change what the provider bills
 * without changing anything the user reads.
 * @param at - the instant to stamp, at ISO 8601 precision.
 * @returns the line to prepend to the duplicate's system prompt.
 */
export function billionaireStamp(at: Date): string {
  return `[i-am-rich] ${at.toISOString()}`
}

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