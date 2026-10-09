/**
 * Behavior of the i-am-rich duplicate burn: each intercepted model call must
 * dispatch a real second request, discard its chunks, and record the
 * duplicate's own provider usage as durable waste.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import { apply } from '../src/index.ts'
import { resetWasteRecordCapability } from '../src/records.ts'
import { WASTE_RECORD_TYPE, type LlmWasteEventData } from '../src/types.ts'

const USAGE: TokenUsage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 }

/**
 * Records the session doubles handed to the harness's plugin-record API.
 *
 * The write path feature-detects `appendPluginRecord` on the session module,
 * so these cases control that export directly: an implementation models a
 * harness new enough to have it, and `undefined` models one too old to.
 */
const harness = vi.hoisted(() => ({
  appendPluginRecord: undefined as ((session: unknown, type: string, data: unknown) => number) | undefined,
}))

vi.mock('@deepseek-ai/dsh-session', () => ({
  get appendPluginRecord() {
    return harness.appendPluginRecord
  },
}))

/** A scripted stream that reports `usage` before its terminal finish. */
function scripted(usage: TokenUsage): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'hello' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
    { type: 'usage', usage },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

interface Appended {
  readonly type: string
  readonly data: unknown
}

/**
 * Minimal session double standing in for the harness Session.
 *
 * `append` is deliberately absent: the plugin must never reach for a bare
 * `Session.append`, because that path cannot set the `ignorable` marker an
 * unknown event type requires. Reaching for it is a hard failure here.
 */
function fakeSession(events: Appended[]) {
  return {
    events,
    append: () => { throw new Error('the plugin must not call a bare Session.append') },
  }
}

/**
 * Model a harness that supports plugin records.
 *
 * Each call is routed to the appended-events list of the session it targets,
 * reproducing the harness contract that `appendPluginRecord(session, type,
 * data)` writes into that session's log.
 */
function supportPluginRecords(): void {
  harness.appendPluginRecord = (session: unknown, type: string, data: unknown) => {
    const target = session as { events: Appended[] }
    target.events.push({ type, data })
    return target.events.length
  }
}

/** Model a harness too old to expose the plugin-record API. */
function withholdPluginRecords(): void {
  harness.appendPluginRecord = undefined
}

beforeEach(() => {
  supportPluginRecords()
  resetWasteRecordCapability()
})

afterEach(() => {
  resetWasteRecordCapability()
  vi.restoreAllMocks()
})

/**
 * Build a context whose `agents` registry reports exactly the given sessions.
 *
 * `sessionProjections` is stubbed because the plugin registers its ledger
 * projection at load; these cases exercise the burn, not the fold.
 * @param sessions - live sessions the registry should expose.
 * @param initiator - agent reported as the inherited initiator, when any.
 * @returns the plugin context under test.
 */
function contextWith(sessions: readonly unknown[], initiator?: unknown): Context {
  const ctx = new Context()
  ctx.reflect.provide('agents', {
    list: () => sessions,
    currentInitiator: () => initiator,
  })
  ctx.reflect.provide('sessionProjections', { register: () => () => {} })
  return ctx
}

const OPTIONS: GenerateOptions = { provider: 'test', model: 'test-model', messages: [] }

describe('i-am-rich duplicate burn', () => {
  it('invokes the underlying adapter twice while forwarding only the original stream', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    // The adapter is the terminal continuation: counting its invocations is the
    // only assertion that proves a second real provider call was made.
    let adapterCalls = 0
    const adapter = () => {
      adapterCalls += 1
      return (async function * () { yield * scripted(USAGE) })()
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, adapter)) chunks.push(chunk)
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    expect(adapterCalls).toBe(2)
    expect(chunks).toEqual(scripted(USAGE))
  })

  it('records the duplicate usage as waste without changing the caller stream', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) chunks.push(chunk)
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    expect(chunks).toHaveLength(5)
    expect(events[0]?.type).toBe(WASTE_RECORD_TYPE)
    expect(events[0]?.data).toMatchObject({
      provider: 'test',
      model: 'test-model',
      outcome: 'discarded',
      usage: USAGE,
    })
  })

  it('records one waste event per discarded copy', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] }, { enabled: true, discardedCopies: 2 })

    let calls = 0
    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => {
      calls += 1
      return (async function * () { yield * scripted(USAGE) })()
    })) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(2) })

    expect(calls).toBe(3)
    expect(events.map(event => event.type)).toEqual([WASTE_RECORD_TYPE, WASTE_RECORD_TYPE])
  })

  it('records a failed duplicate that threw before reporting usage', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    let call = 0
    const adapter = () => {
      call += 1
      return call === 1
        ? (async function * () { yield * scripted(USAGE) })()
        // A generator that only throws is deliberate: the duplicate must fail
        // through the same AsyncIterable channel a real transport error uses.
        // oxlint-disable-next-line require-yield
        : (async function * () { throw new Error('duplicate transport failure') })()
    }

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, adapter)) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    // A duplicate that died without reporting usage claims no token amount.
    expect(events[0]?.data).toMatchObject({ outcome: 'failed' })
    expect(events[0]?.data).not.toHaveProperty('usage')
  })

  it('keeps a partial usage report from a duplicate that failed mid-stream', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    let call = 0
    const adapter = () => {
      call += 1
      if (call === 1) return (async function * () { yield * scripted(USAGE) })()
      return (async function * () {
        yield { type: 'usage', usage: USAGE } satisfies StreamChunk
        throw new Error('duplicate died after reporting usage')
      })()
    }

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, adapter)) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    // Whatever the provider billed before the failure is still real spend.
    expect(events[0]?.data).toMatchObject({ outcome: 'failed', usage: USAGE })
  })

  it('records nothing when no single session owns the request', async () => {
    const events: Appended[] = []
    const ctx = contextWith([])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) { /* drain */ }
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(events).toHaveLength(0)
  })

  it('attributes by initiator when several agents are live', async () => {
    // The regression this covers: a multi-agent deployment (teammates,
    // subagents, a resumed sibling) used to make `list()` length 2+, which
    // silently discarded the record of spend that really happened.
    const events: Appended[] = []
    const owner = { session: fakeSession(events) }
    const ctx = contextWith([{ session: fakeSession([]) }, owner], owner)
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    expect(events[0]?.type).toBe(WASTE_RECORD_TYPE)
    expect(events[0]?.data).toMatchObject({ usage: USAGE })
  })

  it('resolves the owner at request time, not when the duplicate drains', async () => {
    // The duplicate outlives the request. Ownership must be read synchronously
    // while the request is in flight, or a sibling agent appearing later makes
    // the owner ambiguous after the money was already spent.
    const events: Appended[] = []
    const owner = { session: fakeSession(events) }
    let live: unknown[] = [owner]
    const ctx = new Context()
    ctx.reflect.provide('agents', { list: () => live, currentInitiator: () => undefined })
    ctx.reflect.provide('sessionProjections', { register: () => () => {} })
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    const adapter = () => (async function * () {
      yield { type: 'usage', usage: USAGE } satisfies StreamChunk
      // A second agent registers while the duplicate is still draining.
      live = [owner, { session: fakeSession([]) }]
      yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
    })()

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, adapter)) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(1) })

    expect(events[0]?.data).toMatchObject({ usage: USAGE })
  })

  it('does not intercept when disabled', async () => {
    const ctx = contextWith([{ session: fakeSession([]) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] }, { enabled: false, discardedCopies: 1 })
    const seen = vi.fn(() => (async function * () { yield * scripted(USAGE) })())

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, seen)) { /* drain */ }

    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('mints a distinct discard identity per record', async () => {
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    let counter = 0
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] }, { enabled: true, discardedCopies: 2 }, { newId: () => `id-${++counter}` })

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) { /* drain */ }
    await vi.waitFor(() => { expect(events).toHaveLength(2) })

    const ids = events.map(event => (event.data as LlmWasteEventData).wasteId)
    expect(new Set(ids).size).toBe(2)
  })

  it('still burns without recording when the harness has no plugin-record API', async () => {
    // The regression this covers: on a harness that cannot write an ignorable
    // record, the old code called `Session.append('llm/waste', …)`. That wrote
    // an unknown, unmarked event type, and the persistence read path then
    // refused the *entire* session log:
    //
    //   session "…" contains event type "llm/waste" (seq …) unknown to this
    //   harness and not marked ignorable; refusing to interpret the log
    //
    // Losing one statistic is recoverable; losing the session is not. The burn
    // continues, and nothing at all is written.
    withholdPluginRecords()
    const events: Appended[] = []
    const ctx = contextWith([{ session: fakeSession(events) }])
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] })

    let adapterCalls = 0
    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => {
      adapterCalls += 1
      return (async function * () { yield * scripted(USAGE) })()
    })) { /* drain */ }
    await new Promise(resolve => setTimeout(resolve, 10))

    // The duplicate was still sent (real spend), but the log stayed clean.
    expect(adapterCalls).toBe(2)
    expect(events).toHaveLength(0)
  })

  it('warns once per load when the harness cannot record plugin records', async () => {
    withholdPluginRecords()
    const ctx = contextWith([{ session: fakeSession([]) }])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin({ apply, inject: ['agents', 'sessionProjections'] }, { enabled: true, discardedCopies: 2 })

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) { /* drain */ }
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })

    const notices = warn.mock.calls.filter(([message]) => typeof message === 'string' && message.includes('appendPluginRecord'))
    expect(notices).toHaveLength(1)
  })
})