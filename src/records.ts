/**
 * The single write path for discarded-usage records.
 *
 * A record that a harness cannot classify as safe-to-skip will make that
 * harness refuse the whole session log, so this module never falls back to a
 * plain `Session.append` for an unrecognized event type. It probes for the
 * supported plugin-record API and, when the running harness is too old to have
 * it, reports the record as unwritable instead of poisoning the log.
 *
 * Feature detection is a runtime property test rather than a version compare:
 * the harness is loaded from the app bundle, and the API's presence is the
 * only fact that decides whether a write is safe.
 */

import type { LlmWasteEventData } from './types.ts'
import { WASTE_RECORD_TYPE } from './types.ts'

/** The subset of a Session this write path needs. */
export interface WasteRecordSink {
  /**
   * Append one discarded-usage record.
   * @param data - the discard to record.
   * @returns the record's sequence number, or `undefined` when this harness
   *   cannot write an ignorable plugin record.
   */
  appendWaste(data: LlmWasteEventData): number | undefined
}

/** Shape of the `appendPluginRecord` export this module depends on. */
type AppendPluginRecord = (session: unknown, type: string, data: unknown) => number

/**
 * Resolve the harness's `appendPluginRecord` export, when this build has one.
 *
 * The harness package is loaded by the host process, not by this package, so
 * the module namespace is resolved lazily and its absence is an expected,
 * supported outcome on harness versions before `0.2.1-alpha.2` — not an error.
 * @returns the append function, or `undefined` on a harness that lacks it.
 */
let resolved: AppendPluginRecord | null | undefined

async function loadAppendPluginRecord(): Promise<AppendPluginRecord | undefined> {
  if (resolved !== undefined) return resolved ?? undefined
  try {
    const sessionModule: Record<string, unknown> = await import('@deepseek-ai/dsh-session')
    const candidate = sessionModule['appendPluginRecord']
    resolved = typeof candidate === 'function' ? (candidate as AppendPluginRecord) : null
  } catch {
    // A resolution failure means the API is unavailable to this plugin; the
    // caller degrades to a reported unwritable record rather than a bad write.
    resolved = null
  }
  return resolved ?? undefined
}

/** Reset the memoized probe. Test-only. */
export function resetWasteRecordCapability(): void {
  resolved = undefined
}

/**
 * Whether this harness can write an ignorable plugin record.
 *
 * Exposed so the Host plugin can report a single actionable warning instead of
 * failing silently on every discard.
 * @returns true when {@link appendWasteRecord} can succeed.
 */
export async function canAppendWasteRecord(): Promise<boolean> {
  return await loadAppendPluginRecord() !== undefined
}

/**
 * Append one discarded-usage record through the harness's supported API.
 *
 * Returns `undefined` when the running harness predates `appendPluginRecord`.
 * The caller must treat that as "not recorded" and must not retry through a
 * path that writes an unmarked event: an unmarked unknown type makes the whole
 * session log unreadable, which is strictly worse than a missing statistic.
 * @param session - the Session that owns the discarded request.
 * @param data - the discard to record.
 * @returns the committed sequence number, or `undefined` when unsupported.
 */
export async function appendWasteRecord(session: unknown, data: LlmWasteEventData): Promise<number | undefined> {
  const append = await loadAppendPluginRecord()
  if (append === undefined) return undefined
  const seq = append(session, WASTE_RECORD_TYPE, data)
  return typeof seq === 'number' ? seq : undefined
}