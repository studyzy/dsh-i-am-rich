/**
 * Durable records for the i-am-rich plugin's discarded duplicate requests.
 *
 * Every record describes one duplicate model call whose full stream was
 * received and thrown away. The record is non-surface: nothing in it produces
 * an LLM message, so a reader that ignores it reconstructs an identical
 * surface.
 *
 * ## Why the record name is `plugin:…`
 *
 * A plugin event name that is not in the harness's `SessionEventMap` must be
 * written with the envelope's `ignorable` marker. Without that marker the
 * persistence read path refuses the *entire log*:
 *
 * > session "…" contains event type "…" unknown to this harness and not
 * > marked ignorable; refusing to interpret the log — it was likely written
 * > by a newer harness
 *
 * Declaring the type through `declare module '…/types'` is compile-time only:
 * it teaches this package's TypeScript that the event exists, but it does not
 * register the name with any harness. The harness's own `Session.append()`
 * builds the event envelope itself and offers no way to set `ignorable`, so a
 * plugin cannot mark a plain `SessionEventMap` member ignorable through it.
 *
 * The supported path is `appendPluginRecord`, which stamps `ignorable: true`
 * and requires a name in the `plugin:` namespace. It is reached through
 * {@link appendWasteRecord} below.
 *
 * `plugin:i-am-rich/waste` keeps the discarded-usage meaning while following
 * that grammar (`plugin:` + lowercase slash-separated segments).
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm/types'

/**
 * The durable record name for one discarded duplicate request.
 *
 * Namespaced under `plugin:` so the harness retains and skips it on a reader
 * that does not know the type, instead of refusing the log.
 */
export const WASTE_RECORD_TYPE = 'plugin:i-am-rich/waste' as const

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

/**
 * Historical record name written before the `plugin:` namespace was adopted.
 *
 * Retained only so the projection can still fold logs written by earlier
 * versions of this plugin. Never written by this version: it is not a legal
 * `PluginRecordType`, so a harness cannot be asked to retain it safely.
 */
export const LEGACY_WASTE_RECORD_TYPE = 'llm/waste' as const

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /**
     * Durable, non-surface record of one discarded duplicate model request.
     *
     * Recorded when the duplicate's stream ends, so the record marks real
     * spend that produced no assistant message. Written through
     * `appendPluginRecord`, which marks it `ignorable` so a harness that does
     * not know the type retains and skips it rather than refusing the log.
     */
    'plugin:i-am-rich/waste': LlmWasteEventData
  }
}