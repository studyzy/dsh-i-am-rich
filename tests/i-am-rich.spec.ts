/**
 * Behavior of the i-am-rich duplicate burn: each intercepted model call must
 * dispatch a real second request, discard its chunks, and append the
 * duplicate's own provider usage to the standalone ledger file.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import { closeLedgerHandles, ledgerMonthPath } from '../src/ledger-file.ts'
import { apply, type IAmRichInternals } from '../src/index.ts'
import type { LlmWasteEventData } from '../src/types.ts'

const USAGE: TokenUsage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 }

/**
 * The failure a ledger append should reject with, when any.
 *
 * The write path is fire-and-forget, so these cases inject failure at the
 * module seam rather than simulating a broken disk.
 */
const ledger = vi.hoisted(() => ({ failure: undefined as Error | undefined }))

vi.mock('../src/ledger-file.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ledger-file.ts')>()
  return {
    ...actual,
    appendLedgerEntry: (root: string, data: Parameters<typeof actual.appendLedgerEntry>[1]) =>
      ledger.failure !== undefined ? Promise.reject(ledger.failure) : actual.appendLedgerEntry(root, data),
  }
})

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

/** The ledger root under test, replaced per test and removed afterwards. */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'i-am-rich-'))
})

afterEach(async () => {
  ledger.failure = undefined
  await closeLedgerHandles()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Hooks pinning day and identity so appended lines are deterministic. */
const INTERNALS: IAmRichInternals = {
  newId: () => 'w-fixed',
  now: () => new Date(2026, 0, 5, 12, 0, 0),
  root: undefined,
}

/** Internals bound to the current test's ledger root. */
function internals(overrides: Partial<IAmRichInternals> = {}): IAmRichInternals {
  return { ...INTERNALS, root, ...overrides }
}

/** Every discard line appended to this test's ledger, in order. */
async function ledgerLines(month = '2026-01'): Promise<LlmWasteEventData[]> {
  try {
    const text = await readFile(ledgerMonthPath(root, month), 'utf8')
    return text.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as LlmWasteEventData)
  } catch {
    return []
  }
}

/**
 * Build a bare plugin context.
 *
 * No `connection` service is provided: these cases exercise the burn and the
 * file ledger, and the route registers through a warned no-op here.
 * @returns the plugin context under test.
 */
function contextWith(): Context {
  return new Context()
}

const OPTIONS: GenerateOptions = { provider: 'test', model: 'test-model', messages: [] }

/**
 * A request shaped like a loop-built one, which is what the billionaire tier
 * needs in order to stamp anything.
 *
 * The stamp goes into the head of the existing system message, so a request
 * without one cannot carry a prefix at all — the tier falls back to the
 * verbatim copy there, by design. Cases that mean to exercise the stamped
 * duplicate must therefore dispatch this shape rather than {@link OPTIONS}.
 */
const SYSTEM_OPTIONS: GenerateOptions = {
  provider: 'test',
  model: 'test-model',
  messages: [
    { role: 'system', id: 'sys-1', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'be brief' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ] as GenerateOptions['messages'],
}

describe('i-am-rich duplicate burn', () => {
  it('invokes the underlying adapter twice while forwarding only the original stream', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

    // The adapter is the terminal continuation: counting its invocations is the
    // only assertion that proves a second real provider call was made.
    let adapterCalls = 0
    const adapter = () => {
      adapterCalls += 1
      return (async function * () { yield * scripted(USAGE) })()
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, adapter)) chunks.push(chunk)
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    expect(adapterCalls).toBe(2)
    expect(chunks).toEqual(scripted(USAGE))
  })

  it('records the duplicate usage in the ledger without changing the caller stream', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) chunks.push(chunk)
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    expect(chunks).toHaveLength(5)
    const lines = await ledgerLines()
    expect(lines[0]).toMatchObject({
      provider: 'test',
      model: 'test-model',
      outcome: 'discarded',
      day: '2026-01-05',
      usage: USAGE,
    })
  })

  it('records one ledger line per discarded copy', async () => {
    const ctx = contextWith()
    let counter = 0
    apply(ctx, { enabled: true, discardedCopies: 2 }, internals({ newId: () => `id-${++counter}` }))

    let calls = 0
    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => {
      calls += 1
      return (async function * () { yield * scripted(USAGE) })()
    })) { /* drain */ }
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(2) })

    expect(calls).toBe(3)
    const lines = await ledgerLines()
    // Each discard carries its own identity: two lines, two ids.
    expect(new Set(lines.map(line => line.wasteId)).size).toBe(2)
  })

  it('records a failed duplicate that threw before reporting usage', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

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
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    // A duplicate that died without reporting usage claims no token amount.
    const lines = await ledgerLines()
    expect(lines[0]).toMatchObject({ outcome: 'failed' })
    expect(lines[0]).not.toHaveProperty('usage')
  })

  it('keeps a partial usage report from a duplicate that failed mid-stream', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

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
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    // Whatever the provider billed before the failure is still real spend.
    const lines = await ledgerLines()
    expect(lines[0]).toMatchObject({ outcome: 'failed', usage: USAGE })
  })

  it('does not intercept when disabled', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: false, discardedCopies: 1 }, internals())
    const seen = vi.fn(() => (async function * () { yield * scripted(USAGE) })())

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, seen)) { /* drain */ }
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(seen).toHaveBeenCalledTimes(1)
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('warns and keeps the original stream when a ledger write fails', async () => {
    // The regression this covers: a broken ledger must never surface as a
    // broken chat. Losing one statistic is recoverable; losing the turn is not.
    const ctx = contextWith()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ledger.failure = new Error('disk full')
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) chunks.push(chunk)

    expect(chunks).toEqual(scripted(USAGE))
    await vi.waitFor(() => {
      expect(warn.mock.calls.some(([message]) => typeof message === 'string' && message.includes('failed to record'))).toBe(true)
    })
  })

  it('never touches the harness session log', async () => {
    // The ledger is standalone: nothing the plugin does may reach a Session,
    // so no session double is even installed — reaching for one would fail.
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1 }, internals())

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => (async function * () {
      yield * scripted(USAGE)
    })())) { /* drain */ }
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    const lines = await ledgerLines()
    expect(lines[0]).toMatchObject({ usage: USAGE })
  })
})

describe('i-am-rich fortune tiers', () => {
  it('dispatches the billionaire duplicate with a stamped system prompt, through a real second call', async () => {
    const ctx = contextWith()
    // A stub `llm` service is what the nested dispatch goes through; the
    // waterfall re-entry is the behavior under test, not a detail.
    const seen: GenerateOptions[] = []
    const llm = {
      stream: (options: GenerateOptions) => {
        seen.push(options)
        return (async function * () { yield * scripted(USAGE) })()
      },
    }
    ;(ctx as unknown as { llm: typeof llm }).llm = llm
    apply(ctx, { enabled: true, discardedCopies: 1, fortune: 'billionaire' }, internals())

    let adapterCalls = 0
    const original = { ...OPTIONS, messages: [
      { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ] } as GenerateOptions
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.waterfall(ctx, 'llm/stream', original, () => {
      adapterCalls += 1
      return (async function * () { yield * scripted(USAGE) })()
    })) chunks.push(chunk)
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    // The original still went out once through the continuation...
    expect(adapterCalls).toBe(1)
    // ...and the duplicate went out through the nested dispatch, stamped.
    expect(seen).toHaveLength(1)
    const duplicate = seen[0]
    expect(duplicate).toBeDefined()
    // The stamp rides in the existing system message's head, so the message
    // count is unchanged: no extra message was inserted for the duplicate.
    expect(duplicate!.messages).toHaveLength(original.messages.length)
    const system = duplicate!.messages[0]!
    expect(system.role).toBe('system')
    expect(system.content[0]).toMatchObject({ type: 'text' })
    expect((system.content[0] as { text: string }).text).toContain('[i-am-rich]')
    // The original prompt text is still behind the stamp.
    expect(system.content[1]).toEqual({ type: 'text', text: 'be brief' })
  })

  it('does not duplicate the duplicate when the nested dispatch re-enters the waterfall', async () => {
    const ctx = contextWith()
    let nestedCalls = 0
    const llm = {
      stream: (options: GenerateOptions) => {
        nestedCalls += 1
        // Re-enter the real waterfall, exactly as the harness's own `llm.stream`
        // does; the guard is what must stop the recursion here.
        return ctx.waterfall(ctx, 'llm/stream', options, () => (async function * () { yield * scripted(USAGE) })())
      },
    }
    ;(ctx as unknown as { llm: typeof llm }).llm = llm
    apply(ctx, { enabled: true, discardedCopies: 1, fortune: 'billionaire' }, internals())

    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', SYSTEM_OPTIONS, () => (async function * () { yield * scripted(USAGE) })())) { /* drain */ }
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    // Exactly one nested dispatch: the re-entrant listener passed through.
    expect(nestedCalls).toBe(1)
  })

  it('falls back to the continuation when the harness has no llm service', async () => {
    const ctx = contextWith()
    apply(ctx, { enabled: true, discardedCopies: 1, fortune: 'billionaire' }, internals())

    let adapterCalls = 0
    for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => {
      adapterCalls += 1
      return (async function * () { yield * scripted(USAGE) })()
    })) { /* drain */ }
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(1) })

    // Still two real calls — the burn is not silently skipped just because the
    // prefix could not be applied.
    expect(adapterCalls).toBe(2)
    expect(await ledgerLines()).toHaveLength(1)
  })
})

describe('i-am-rich fortune concurrency', () => {
  it('duplicates every one of several in-flight requests without cross-talk', async () => {
    // The re-entrancy guard is a module-level flag, so this is the case that
    // would break if it were ever held across an await: one request's nested
    // dispatch would silence another request's duplication.
    const ctx = contextWith()
    let nestedCalls = 0
    const llm = {
      stream: (_options: GenerateOptions) => {
        nestedCalls += 1
        return (async function * () { yield * scripted(USAGE) })()
      },
    }
    ;(ctx as unknown as { llm: typeof llm }).llm = llm
    apply(ctx, { enabled: true, discardedCopies: 1, fortune: 'billionaire' }, internals())

    let adapterCalls = 0
    const run = async (): Promise<StreamChunk[]> => {
      const out: StreamChunk[] = []
      for await (const chunk of ctx.waterfall(ctx, 'llm/stream', SYSTEM_OPTIONS, () => {
        adapterCalls += 1
        return (async function * () { yield * scripted(USAGE) })()
      })) out.push(chunk)
      return out
    }

    const results = await Promise.all([run(), run(), run()])
    await vi.waitFor(async () => { await expect(ledgerLines()).resolves.toHaveLength(3) })

    // Three originals and three prefixed duplicates, and every caller still got
    // its own untouched stream.
    expect(adapterCalls).toBe(3)
    expect(nestedCalls).toBe(3)
    for (const chunks of results) expect(chunks).toEqual(scripted(USAGE))
  })
})
