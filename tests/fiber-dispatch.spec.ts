/**
 * Billionaire-tier dispatch in the shape a real harness presents.
 *
 * Every other spec either runs on a bare `new Context()` with `ctx.llm`
 * assigned as an own property, or omits `llm` entirely. A real harness instead
 * provides `llm` through the service registry, and its `stream` runs the
 * `llm/stream` waterfall — so the stamped duplicate re-enters every listener,
 * including this plugin's own. These cases pin that identity-based pass-through
 * burns exactly one extra adapter call, carries the stamped prefix, and leaves
 * the original request untouched.
 *
 * @module tests/fiber-dispatch
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, closeLedgerHandles, type IAmRichInternals } from '../src/index.ts'

const OPTIONS: GenerateOptions = {
  provider: 'test',
  model: 'test-model',
  messages: [{ id: 's1', source: 'system', role: 'system', content: [{ type: 'text', text: 'sys' }] }],
} as never

const USAGE = { inputTokens: 3, outputTokens: 4, totalTokens: 7 } as never

/** One scripted provider stream carrying a usage report and a clean finish. */
function scripted(): StreamChunk[] {
  return [
    { type: 'usage', usage: USAGE },
    { type: 'finish', reason: { kind: 'stop' } },
  ] as StreamChunk[]
}

/** The ledger root under test, replaced per test and removed afterwards. */
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'i-am-rich-fiber-dispatch-'))
})

afterEach(async () => {
  await closeLedgerHandles()
  await rm(root, { recursive: true, force: true })
})

/** Hooks pinning day and identity so the ledger stays deterministic. */
function internals(): IAmRichInternals {
  return { newId: () => 'w-fixed', now: () => new Date(2026, 0, 5, 12, 0, 0), root }
}

/**
 * Run one burn inside a real, activated cordis plugin fiber with a provided
 * `llm` service whose `stream` re-runs the waterfall.
 * @param config - plugin config for the run.
 * @returns the adapter call count and the request options each call saw.
 */
async function burnInsideFiber(config: {
  readonly fortune: 'millionaire' | 'billionaire'
}): Promise<{ adapterCalls: number; seen: GenerateOptions[] }> {
  const parent = new Context()
  parent.provide('connection', {
    fetch: { register: () => async () => { /* route disposer */ } },
  })
  const seen: GenerateOptions[] = []
  let adapterCalls = 0
  let done!: () => void
  const finished = new Promise<void>(resolve => { done = resolve })

  // The real `LlmRuntime.stream` dispatches through the `llm/stream` waterfall;
  // a stamped duplicate must survive that re-entry exactly once.
  parent.provide('llm', {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      return parent.waterfall(parent, 'llm/stream', options, () => {
        adapterCalls += 1
        seen.push(options)
        return (async function * () { yield * scripted() })()
      })
    },
  })

  parent.plugin({
    name: 'i-am-rich-fiber-dispatch-probe',
    inject: ['connection'],
    apply(ctx: Context) {
      apply(ctx, { enabled: true, discardedCopies: 1, fortune: config.fortune }, internals())
      void (async () => {
        for await (const _chunk of parent.waterfall(parent, 'llm/stream', OPTIONS, () => {
          adapterCalls += 1
          return (async function * () { yield * scripted() })()
        })) { /* drain */ }
        done()
      })()
    },
  } as never)

  await finished
  return { adapterCalls, seen }
}

describe('billionaire dispatch through a waterfall-running llm service', () => {
  it('dispatches the stamped clone once and leaves the original untouched', async () => {
    const { adapterCalls, seen } = await burnInsideFiber({ fortune: 'billionaire' })
    expect(adapterCalls).toBe(2)
    expect(seen).toHaveLength(1)
    // The clone carries the stamp in its system prompt's head…
    const clone = seen[0]!
    expect(clone).not.toBe(OPTIONS)
    expect(clone.messages[0]).not.toBe(OPTIONS.messages[0])
    expect(clone.messages).toHaveLength(OPTIONS.messages.length)
    // …while the original request object keeps its own content.
    expect(OPTIONS.messages[0]?.content).toHaveLength(1)
  })

  it('dispatches the verbatim continuation for the millionaire tier', async () => {
    const { adapterCalls, seen } = await burnInsideFiber({ fortune: 'millionaire' })
    // Millionaire re-calls the continuation, which the inner stub does not see.
    expect(adapterCalls).toBe(2)
    expect(seen).toHaveLength(0)
  })
})
