/**
 * Rich-person plugin: sends every model request twice and throws the second
 * copy away, then burns the discarded copy's provider usage into a durable
 * `llm/waste` record that the Web status bar reports as today's waste.
 *
 * The duplicate is dispatched through the same `llm/stream` waterfall
 * continuation as the original, so it is a real, fully billed provider call.
 * Its chunks are never forwarded to the caller: only the original stream
 * reaches the agent loop, so the duplicate cannot alter the turn.
 *
 * @module @deepseek-ai/dsh-i-am-rich
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Value-free import: brings the `ctx.agents` Context augmentation into scope.
import type {} from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-session-projection'
import { WasteId } from './brand.ts'
import { createWasteLedgerProjection } from './projection.ts'
import { localDay } from './waste.ts'
import type { LlmWasteEventData, WasteOutcome } from './types.ts'

export type { LlmWasteEventData, WasteOutcome } from './types.ts'
// `WasteId` is one name carrying both a type and a constructor.
export { WasteId } from './brand.ts'
export { addWaste, EMPTY_TOTALS, localDay, localMonth, sumPeriods, toMagnitude, totalTokens, type Magnitude, type MagnitudeUnit, type WastePeriods, type WasteTotals } from './waste.ts'
export { createWasteLedgerProjection, type WasteLedgerState, type WasteLedgerView } from './projection.ts'

export const name = 'i-am-rich'
export const inject = ['agents', 'sessionProjections']

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
 * discarded copy, whose chunks are thrown away. Every discard is recorded as a
 * durable `llm/waste` event so the amount burned survives reload and replay.
 * @param ctx - plugin context owning the waterfall listener.
 * @param config - resolved burn configuration.
 * @param internals - non-serializable deterministic hooks for tests.
 */
export function apply(ctx: Context, config: Config = { enabled: true, discardedCopies: 1 }, internals: IAmRichInternals = {}): void {
  const newId = internals.newId ?? (() => randomUUID())
  const now = internals.now ?? (() => new Date())

  // Registered before the burn so a discard appended during startup already has
  // its projection unit, and the status bar reads a folded value immediately.
  ctx.sessionProjections.register(createWasteLedgerProjection())

  if (!config.enabled) return

  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    const original = next()
    // Resolved synchronously, at request time: the session that owns this
    // request is the one live when the request is issued. Resolving it later,
    // after the duplicate drains, races the agent registry — a sibling agent
    // or subagent created during the request would make the owner ambiguous
    // and silently discard the record of spend that really happened.
    const owner = activeSession(ctx)
    for (let copy = 0; copy < config.discardedCopies; copy += 1) {
      // Started before iteration so every copy is in flight alongside the
      // original, exactly as several billed requests would be.
      void burn(next()).then((result) => {
        if (owner === undefined) return
        const data: LlmWasteEventData = {
          wasteId: WasteId(newId()),
          provider: options.provider,
          model: options.model,
          outcome: result.outcome,
          day: localDay(now()),
          ...result.usage === undefined ? {} : { usage: result.usage },
        }
        owner.append('llm/waste', data)
      }, (error: unknown) => {
        ctx.logger.warn('i-am-rich: failed to record a discarded duplicate request: %o', error)
      })
    }
    return original
  })
}

/**
 * The session that owns a model request.
 *
 * Two sources, in order of authority:
 *
 * 1. The inherited initiator — the agent whose driver chain issued this call.
 *    This is exact, and it is also the only source that survives several live
 *    agents (a teammate session, a subagent, a concurrently-resumed session).
 * 2. The sole live agent, for a call made outside an initiator boundary where
 *    exactly one agent exists.
 *
 * With no initiator *and* an ambiguous registry the burn is still performed but
 * left unrecorded, rather than charged to a session that may not have issued
 * it. That case is genuinely ambiguous; a multi-agent deployment is not.
 * @param ctx - plugin context exposing the agent registry.
 * @returns the owning session, or undefined when attribution is truly ambiguous.
 */
function activeSession(ctx: Context): { append: (type: 'llm/waste', data: LlmWasteEventData) => unknown } | undefined {
  const initiator = ctx.agents.currentInitiator()
  if (initiator !== undefined) return initiator.session
  const agents = ctx.agents.list()
  if (agents.length !== 1) return undefined
  return agents[0]?.session
}