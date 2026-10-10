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
 * @module @studyzy/dsh-i-am-rich
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm/types'
// Value-free import: brings the `ctx.on('llm/stream')` Events augmentation into scope.
import type {} from '@deepseek-ai/dsh-agent'
import { WasteId } from './brand.ts'
import { asFortuneWriterContext, createFortuneWriter } from './fortune-config.ts'
import { appendLedgerEntry, closeLedgerHandles, ledgerRoot } from './ledger-file.ts'
import { registerFortuneRoute, registerWasteLedgerRoute } from './ledger-server.ts'
import { localDay } from './waste.ts'
import { billionaireStamp, FORTUNE_TIERS, type FortuneTier, type LlmWasteEventData, type WasteOutcome } from './types.ts'

export type { FortuneTier, LlmWasteEventData, WasteOutcome } from './types.ts'
export { billionaireStamp, FORTUNE_TIERS, LEDGER_LINE_VERSION } from './types.ts'
export { appendLedgerEntry, closeLedgerHandles, ledgerMonthPath, ledgerRoot, readLedgerDays } from './ledger-file.ts'
export { createWasteLedgerRoute, createFortuneRoute, registerFortuneRoute, registerWasteLedgerRoute, FORTUNE_PATH, WASTE_LEDGER_PATH, type FortunePayload, type FortuneWriter, type WasteLedgerConnection, type WasteLedgerFetchRoute } from './ledger-server.ts'
export { asFortuneWriterContext, createFortuneWriter, currentFortune, type ConfigEditorService, type FortuneWriterContext } from './fortune-config.ts'
// `WasteId` is one name carrying both a type and a constructor.
export { WasteId } from './brand.ts'
export { addWaste, EMPTY_TOTALS, localDay, localMonth, sumPeriods, toMagnitude, totalTokens, type Magnitude, type MagnitudeUnit, type WastePeriods, type WasteTotals } from './waste.ts'

export const name = 'i-am-rich'

/**
 * Services this plugin must have before {@link apply} runs.
 *
 * `connection` is declared rather than merely read, because cordis refuses a
 * bare `ctx.connection` property access on a context that never injected it:
 * the getter throws `cannot get property "connection" without inject`. The
 * route registration used to swallow that throw as "this harness has no Web
 * client", which is indistinguishable from the real no-Web-client shape — so
 * on the Desktop app the ledger was written and burned correctly while the
 * status bar stayed pinned at zero, because the route was never registered.
 *
 * Declaring it also makes cordis hold `apply` until `connection` is provided,
 * which removes the startup-order race the same code was silently losing.
 *
 * Optional in the type sense: a headless harness without the Web client never
 * provides it, and cordis simply never activates this plugin there.
 *
 * `configEditor` is deliberately **not** injected, even though the fortune
 * picker uses it. Injecting a service makes cordis withhold `apply` until it
 * exists, so a harness without the editor would lose the burning and the ledger
 * too — the plugin would simply never start. Reading it through `ctx.get` keeps
 * the tier a bonus capability: without it the plugin still burns and still
 * records, and the picker reports that the choice could not be persisted.
 */
export const inject = ['connection']

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
  /**
   * How much each discarded copy is made to cost.
   *
   * `millionaire` sends the copy verbatim, so it can ride the original's warm
   * prompt cache. `billionaire` stamps {@link billionaireStamp} into the head
   * of the copy's system prompt, changing the prefix so the copy misses that
   * cache and is billed as a cache write. See {@link FortuneTier} for the
   * mechanism.
   */
  readonly fortune: FortuneTier
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  discardedCopies: z.natural().default(1),
  fortune: z.union(FORTUNE_TIERS.map(tier => z.const(tier))).default('millionaire'),
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

/**
 * Build the request one discarded copy is dispatched with.
 *
 * The tier is the whole difference: `millionaire` returns the caller's request
 * untouched, so the duplicate is byte-identical to the original and the
 * provider can serve its prompt prefix from cache.
 *
 * `billionaire` returns a **clone** whose system prompt carries a fresh
 * {@link billionaireStamp} line. It must clone: a loop-built request arrives
 * deep-frozen (its messages are `deepFreeze`d by `dsh-llm`), so writing into
 * the caller's own array would throw and, worse, would edit the request the
 * real turn is using. The clone also keeps the original request object
 * identity intact for the agent loop, which is what lets the real stream still
 * be reconstructed from the log.
 *
 * The stamp goes into the **existing system message's text**, not into an
 * inserted message. Two reasons, in order of importance:
 *
 * 1. It is O(1) in the conversation's size. An inserted leading message forces
 *    a rebuild of the whole `messages` array on every dispatch, and that array
 *    holds the entire conversation — on a long session it is the single largest
 *    object in the request. Rewriting one block copies one string.
 * 2. The message count stays identical to the original's, so the duplicate
 *    differs from the original in exactly one place: the prompt prefix. That
 *    keeps "the cache missed" the only claim this tier makes.
 *
 * A request with no system-role message is left **unstamped** and reported as
 * `prefixed: false`. It cannot be stamped: a system-role entry must be a
 * durable `Message` carrying an `id` and a `source` (only `role: 'user'` may be
 * the identity-free `RequestUserInput` this package can invent), and minting a
 * durable identity for a throwaway copy is exactly what this plugin must not
 * do. The caller falls back to the verbatim copy, which still burns a real
 * call; only the cache miss is lost, and the ledger records the burn either
 * way. Every loop-built request carries a leading system message, so this is
 * the hand-built one-shot shape, not the normal path.
 * @param options - the request the original call is using; never mutated.
 * @param fortune - the configured tier.
 * @param at - the instant to stamp the billionaire tier with.
 * @returns the request to dispatch the duplicate with, and whether it was altered.
 */
export function duplicateRequest(
  options: GenerateOptions,
  fortune: FortuneTier,
  at: Date = new Date(),
): { readonly options: GenerateOptions; readonly prefixed: boolean } {
  if (fortune !== 'billionaire') return { options, prefixed: false }
  const system = options.messages.findIndex(message => message.role === 'system')
  if (system === -1) return { options, prefixed: false }
  const messages = [...options.messages]
  const target = messages[system]!
  // Only the leading block is replaced; every other block (an image, a file
  // reference) and the message's own identity are carried over as they were,
  // so the duplicate stays the same request in every respect but its prefix.
  messages[system] = {
    ...target,
    content: [{ type: 'text', text: billionaireStamp(at) }, ...target.content],
  }
  return { options: { ...options, messages }, prefixed: true }
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
export function apply(ctx: Context, config: Config = { enabled: true, discardedCopies: 1, fortune: 'millionaire' }, internals: IAmRichInternals = {}): void {
  const newId = internals.newId ?? (() => randomUUID())
  const now = internals.now ?? (() => new Date())
  const root = internals.root ?? ledgerRoot()

  // File handles opened for appends must not outlive the plugin; a later
  // reload would otherwise write through stale descriptors.
  ctx.effect(() => closeLedgerHandles, 'i-am-rich: ledger file handles')
  registerWasteLedgerRoute(ctx, root, () => config.fortune)
  // Registered before the `enabled` early return: the fortune choice is config,
  // not spending, so it stays changeable while burning is paused — and a user
  // who pauses spending is exactly who may want to pick the cheaper tier.
  registerFortuneRoute(ctx, createFortuneWriter(asFortuneWriterContext(ctx)))

  if (!config.enabled) return

  ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    // This call is one of our own stamped duplicates arriving back through the
    // waterfall. It must pass straight through: burning it would duplicate the
    // duplicate, and the nested call exists only to carry a different prefix.
    if (stampedDuplicates.has(options)) return next()

    const original = next()
    for (let copy = 0; copy < config.discardedCopies; copy += 1) {
      const { options: duplicateOptions, prefixed } = duplicateRequest(options, config.fortune, now())
      // Started before iteration so every copy is in flight alongside the
      // original, exactly as several billed requests would be. The `.catch`
      // (not a `.then`'s second argument) is load-bearing: only it sees a
      // rejection raised by the append itself, not just one from the burn.
      void burn(dispatchDuplicate(ctx, duplicateOptions, prefixed, next))
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

/**
 * The stamped duplicate requests this plugin dispatched, by object identity.
 *
 * The billionaire tier needs a request object *other* than the one the
 * waterfall closed over, and the only supported way to dispatch a different
 * request is `ctx.llm.stream(...)` — which re-runs the `llm/stream` waterfall
 * and would therefore re-enter this listener and duplicate forever. Each
 * stamped clone is registered here before dispatch, so the listener can
 * recognize its own duplicates and pass them straight through.
 *
 * Identity, not a module flag: two concurrent top-level requests each stamp
 * their own clone, and a flag would have to assume the nested dispatch runs
 * synchronously inside the listener that started it. A per-object marker has
 * no timing dependency at all — the clone is recognized whenever and wherever
 * it re-enters, and originals can never match because identity is unique.
 */
const stampedDuplicates = new WeakSet<GenerateOptions>()

/**
 * Resolve the LLM runtime for the nested duplicate dispatch, or `undefined`
 * when this context has none.
 *
 * Two lookups, because the two context shapes store services differently and
 * only one of them is safe to read blindly:
 *
 * 1. `ctx.get('llm')` — the service registry. This is the path a real harness
 *    takes, and it is non-throwing: an unprovided service reads back as
 *    `undefined`.
 * 2. A guarded `ctx.llm` read — for a bare `new Context()` whose `llm` was
 *    assigned directly as an own property. That assignment never reaches the
 *    registry, so `get` cannot see it, while `Reflect.has` can.
 *
 * Step 2 **must** be wrapped in `try`/`catch`. On an activated plugin fiber the
 * context is a cordis proxy, and a property the fiber neither injects nor
 * provides throws `cannot get property "llm" without inject` instead of
 * yielding `undefined`. That throw is what broke an entire run: `?.` does not
 * guard a throwing getter, so the "defensive" read crashed before it could fall
 * back. Catching it here is what makes the fallback reachable.
 *
 * `llm` is deliberately kept out of `inject`: injecting a service makes cordis
 * withhold `apply` until it exists, so a harness without an LLM runtime would
 * lose the burning and the ledger entirely instead of only the prefix.
 * @param ctx - plugin context owning the fallback dispatch.
 * @returns the runtime exposing `stream`, or `undefined` when unavailable.
 */
function resolveLlm(ctx: Context): { stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk> } | undefined {
  const registered = ctx.get('llm' as never) as
    | { stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk> }
    | undefined
  if (registered !== undefined) return registered
  try {
    return (ctx as { llm?: { stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk> } }).llm
  } catch {
    // A fiber context refuses this property by design; no runtime to dispatch
    // the prefixed duplicate with, so the caller falls back to `next()`.
    return undefined
  }
}

/**
 * Produce the stream one discarded copy is read from.
 *
 * For `millionaire` this is simply `next()`: the duplicate is byte-identical
 * to the original, so the continuation that already carries the original
 * request is exactly right, and calling it twice is what sends two copies.
 *
 * For `billionaire` the copy must carry a different prompt prefix, which means
 * a different request object — and `next()` accepts no request, it only
 * replays the one it closed over. The copy is therefore re-dispatched through
 * `ctx.llm.stream(duplicateOptions)`, guarded so this listener does not
 * duplicate the duplicate. When `ctx.llm` is unavailable the copy falls back to
 * `next()`, which still burns a real call; only the prefix is lost, and that is
 * reported rather than silently pretended.
 * @param ctx - plugin context owning the fallback dispatch.
 * @param options - the request to dispatch the duplicate with.
 * @param prefixed - whether `options` differs from the original's request.
 * @param next - the waterfall continuation, valid only for the original request.
 * @returns the duplicate's chunk stream.
 */
function dispatchDuplicate(
  ctx: Context,
  options: GenerateOptions,
  prefixed: boolean,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  if (!prefixed) return next()
  const llm = resolveLlm(ctx)
  if (llm?.stream === undefined) return next()
  // Registered before dispatch so the nested waterfall run recognizes the
  // clone on re-entry, however asynchronously the dispatch unfolds.
  stampedDuplicates.add(options)
  // Bound to `llm`, not called off `ctx`: the method must keep its receiver.
  return llm.stream.call(llm, options)
}
