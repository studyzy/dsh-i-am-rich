/**
 * Regression coverage for the `cannot get property "llm" without inject` crash.
 *
 * Every other spec builds a bare `new Context()` and assigns `ctx.llm` by
 * hand. A bare context is *not* a cordis proxy, so a property the plugin never
 * injected reads back as `undefined` and the fallback looks correct. Inside an
 * activated plugin fiber the same read **throws** — the proxy refuses a
 * property the fiber neither injects nor provides. The crash therefore only
 * ever reproduced on a real harness, which is exactly what these cases pin:
 * they run `apply` from inside a real fiber that provides only `connection`.
 *
 * @module tests/fiber-context
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, closeLedgerHandles, type IAmRichInternals } from '../src/index.ts'

const OPTIONS: GenerateOptions = { provider: 'test', model: 'test-model', messages: [] }

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
  root = await mkdtemp(join(tmpdir(), 'i-am-rich-fiber-'))
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
 * Run one burn inside a real, activated cordis plugin fiber.
 *
 * `connection` is provided so cordis lets the plugin's `apply` run at all
 * (it is declared in `inject`); `llm` is deliberately **not** provided, which
 * is the shape that produced the crash.
 *
 * @param config - plugin config for the run.
 * @returns the observed adapter call count, the failure (if any), and the
 *   request options seen by the nested dispatch.
 */
async function burnInsideFiber(config: {
  readonly fortune: 'millionaire' | 'billionaire'
}): Promise<{ adapterCalls: number; failure: unknown; seen: GenerateOptions[] }> {
  const parent = new Context()
  // A real harness `connection` carries the `/api` fetch-route registry; the
  // plugin registers its ledger and fortune routes through it, so a bare `{}`
  // would fail inside `apply` before any burn happens.
  parent.provide('connection', {
    fetch: { register: () => async () => { /* route disposer */ } },
  })
  const seen: GenerateOptions[] = []
  let adapterCalls = 0
  let failure: unknown
  let done!: () => void
  const finished = new Promise<void>(resolve => { done = resolve })

  parent.plugin({
    name: 'i-am-rich-fiber-probe',
    inject: ['connection'],
    apply(ctx: Context) {
      apply(ctx, { enabled: true, discardedCopies: 1, fortune: config.fortune }, internals())
      void (async () => {
        try {
          // A stub nested-dispatch target, installed on the *fiber* context so
          // the guarded re-dispatch has somewhere to go. Left uninstalled the
          // plugin must still fall back to the continuation rather than throw.
          for await (const _chunk of ctx.waterfall(ctx, 'llm/stream', OPTIONS, () => {
            adapterCalls += 1
            return (async function * () { yield * scripted() })()
          })) { /* drain */ }
        } catch (error: unknown) {
          failure = error
        } finally {
          done()
        }
      })()
    },
  } as never)

  await finished
  return { adapterCalls, failure, seen }
}

describe('plugin activation inside a real cordis fiber', () => {
  it('does not throw cannot-get-without-inject when llm is not provided', async () => {
    const { failure } = await burnInsideFiber({ fortune: 'billionaire' })
    expect(failure).toBeUndefined()
  })

  it('still burns two real calls with the billionaire tier and no llm service', async () => {
    const { adapterCalls, failure } = await burnInsideFiber({ fortune: 'billionaire' })
    expect(failure).toBeUndefined()
    // The prefix could not be applied without `llm`, but the burn must not be
    // silently skipped: two real provider calls still go out.
    expect(adapterCalls).toBe(2)
  })

  it('burns two real calls with the millionaire tier on a fiber context', async () => {
    const { adapterCalls, failure } = await burnInsideFiber({ fortune: 'millionaire' })
    expect(failure).toBeUndefined()
    expect(adapterCalls).toBe(2)
  })
})