/**
 * Rich-person plugin: sends every model request twice and throws the second
 * copy away, then burns the discarded copy's provider usage into a standalone
 * ledger file that the Web status bar reports as today's waste.
 *
 * The duplicate is dispatched through the same `llm/stream` waterfall
 * continuation as the original, so it is a real, fully billed provider call.
 * Its chunks are never forwarded to the caller: only the original stream
 * reaches the agent loop, so the duplicate cannot alter the turn.
 *
 * The ledger lives outside the harness session log, in monthly append-only
 * JSONL files under the DSH home (see `ledger-file.ts`), and reaches the
 * browser through one exact GET route on the shared `/api` channel (see
 * `ledger-server.ts`). The session log is never touched.
 *
 * @module @deepseek-ai/dsh-i-am-rich
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm/types'
// Value-free import: brings the `ctx.on('llm/stream')` Events augmentation into scope.
import type {} from '@deepseek-ai/dsh-agent'
import { WasteId } from './brand.ts'
import { appendLedgerEntry, closeLedgerHandles, ledgerRoot } from './ledger-file.ts'
import { registerWasteLedgerRoute } from './ledger-server.ts'
import { localDay } from './waste.ts'
import type { LlmWasteEventData, WasteOutcome } from './types.ts'

export type { LlmWasteEventData, WasteOutcome } from './types.ts'
export { LEDGER_LINE_VERSION } from './types.ts'
export { appendLedgerEntry, closeLedgerHandles, ledgerMonthPath, ledgerRoot, readLedgerDays } from './ledger-file.ts'
export { createWasteLedgerRoute, registerWasteLedgerRoute, WASTE_LEDGER_PATH, type WasteLedgerConnection, type WasteLedgerFetchRoute } from './ledger-server.ts'
// `WasteId` is one name carrying both a type and a constructor.
export { WasteId } from './brand.ts'
export { addWaste, EMPTY_TOTALS, localDay, localMonth, sumPeriods, toMagnitude, totalTokens, type Magnitude, type MagnitudeUnit, type WastePeriods, type WasteTotals } from './waste.ts'

export const name = 'i-am-rich'

/** Deployment-varying choices for the duplicate-request burn. */
export interface Config {
  /**
   * Whether each request is duplicated. Turn this off to keep the plugin
   * installed and the status bar live while spending is paused.
   */
  readonly enabled: boolean
  /**
   * How many copies of each request are discarded. `1` sends the request twice
   * and throws one copy away; higher values burn proportionally more.
   */
  readonly discardedCopies: number
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  discardedCopies: z.natural().default(1),
})

/**
 * Non-serializable hooks used to make duplicate identity deterministic in tests.
 */
export interface IAmRichInternals {
  /** Mint each discard identity. */
  readonly newId?: () => string
  /** Read the current local day stamp for a new discard record. */
  readonly now?: () => Date
  /** Write the ledger under this directory instead of the DSH home; tests use it. */
  readonly root?: string
}

/** Extract the last usage sample a duplicate stream reported for itself. */
function streamUsage(chunks: readonly StreamChunk[]): TokenUsage | undefined {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]
    if (chunk?.type === 'usage') return chunk.usage
  }
  return undefined
}

/** The terminal outcome of a duplicate stream, if it reached one. */
function streamOutcome(chunks: readonly StreamChunk[]): WasteOutcome {
  const finish = chunks.findLast(chunk => chunk.type === 'finish')
  return finish?.type === 'finish' && finish.reason.kind === 'stop' ? 'discarded' : 'failed'
}

/**
 * Drain one duplicate stream to completion, retaining only its usage.
 *
 * Content chunks are collected and dropped here; nothing observed returns to
 * the caller except the values the waste record needs. A throw from the
 * duplicate is part of the burn, not a failure of the original request, so it
 * maps to a `failed` discard.
 * @param stream - the duplicate provider stream to consume.
 * @returns the duplicate's outcome and its provider-reported usage, if any.
 */
async function burn(stream: AsyncIterable<StreamChunk>): Promise<{ outcome: WasteOutcome; usage?: TokenUsage }> {
  const seen: StreamChunk[] = []
  try {
    for await (const chunk of stream) seen.push(chunk)
  } catch {
    // A duplicate that dies mid-flight still cost whatever the provider billed
    // before the failure; its partial usage is the honest amount to record.
    const partial = streamUsage(seen)
    return { outcome: 'failed', ...partial === undefined ? {} : { usage: partial } }
  }
  const usage = streamUsage(seen)
  return { outcome: streamOutcome(seen), ...usage === undefined ? {} : { usage } }
}

/**
 * Install duplicate-request burning on the `llm/stream` waterfall.
 *
 * Each intercepted call delegates once for the real request and once per
 * discarded copy, whose chunks are thrown away. Every discard is appended to
 * the standalone ledger as one JSONL line so the amount burned survives
 * reload, and the ledger is served to the Web status bar through a GET route.
 *
 * The ledger is written only through {@link appendLedgerEntry}; a write
 * failure is warned about and never reaches the original request. The route
 * is registered even while burning is disabled, so the status bar stays live
 * and keeps reporting the ledger recorded so far.
 * @param ctx - plugin context owning the waterfall listener.
 * @param config - resolved burn configuration.
 * @param internals - non-serializable deterministic hooks for tests.
 */
export function apply(ctx: Context, config: Config = { enabled: true, discardedCopies: 1 }, internals: IAmRichInternals = {}): void {
  const newId = internals.newId ?? (() => randomUUID())
  const now = internals.now ?? (() => new Date())
  const root = internals.root ?? ledgerRoot()

  // File handles opened for appends must not outlive the plugin; a later
  // reload would otherwise write through stale descriptors.
  ctx.effect(() => closeLedgerHandles, 'i-am-rich: ledger file handles')
  registerWasteLedgerRoute(ctx, root)

  if (!config.enabled) return

  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    const original = next()
    for (let copy = 0; copy < config.discardedCopies; copy += 1) {
      // Started before iteration so every copy is in flight alongside the
      // original, exactly as several billed requests would be. The `.catch`
      // (not a `.then`'s second argument) is load-bearing: only it sees a
      // rejection raised by the append itself, not just one from the burn.
      void burn(next())
        .then((result) => {
          const data: LlmWasteEventData = {
            wasteId: WasteId(newId()),
            provider: options.provider,
            model: options.model,
            outcome: result.outcome,
            day: localDay(now()),
            ...result.usage === undefined ? {} : { usage: result.usage },
          }
          return appendLedgerEntry(root, data)
        })
        .catch((error: unknown) => {
          ctx.logger.warn('i-am-rich: failed to record a discarded duplicate request: %o', error)
        })
    }
    return original
  })
}
