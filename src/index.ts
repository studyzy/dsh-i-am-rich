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
import { createWasteTodayProjection } from './projection.ts'
import { localDay } from './waste.ts'
import type { LlmWasteEventData, WasteOutcome } from './types.ts'

export type { LlmWasteEventData, WasteOutcome } from './types.ts'
// `WasteId` is one name carrying both a type and a constructor.
export { WasteId } from './brand.ts'
export { addWaste, EMPTY_TOTALS, localDay, totalTokens, type WasteTotals } from './waste.ts'
export { createWasteTodayProjection, type WasteTodayState, type WasteTodayView } from './projection.ts'

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
  ctx.sessionProjections.register(createWasteTodayProjection())

  if (!config.enabled) return

  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    const original = next()
    for (let copy = 0; copy < config.discardedCopies; copy += 1) {
      // Started before iteration so every copy is in flight alongside the
      // original, exactly as several billed requests would be.
      void burn(next()).then((result) => {
        const session = activeSession(ctx)
        if (session === undefined) return
        const data: LlmWasteEventData = {
          wasteId: WasteId(newId()),
          provider: options.provider,
          model: options.model,
          outcome: result.outcome,
          day: localDay(now()),
          ...result.usage === undefined ? {} : { usage: result.usage },
        }
        session.append('llm/waste', data)
      }, (error: unknown) => {
        ctx.logger.warn('i-am-rich: failed to record a discarded duplicate request: %o', error)
      })
    }
    return original
  })
}

/**
 * The session whose turn currently owns model requests, when exactly one is active.
 *
 * Attribution is deliberately conservative: with zero or several live agents
 * the burn is still performed but left unrecorded, rather than charged to a
 * session that may not have issued it.
 * @param ctx - plugin context exposing the agent registry.
 * @returns the single active session, or undefined when attribution is ambiguous.
 */
function activeSession(ctx: Context): { append: (type: 'llm/waste', data: LlmWasteEventData) => unknown } | undefined {
  const agents = ctx.agents.list()
  if (agents.length !== 1) return undefined
  return agents[0]?.session
}