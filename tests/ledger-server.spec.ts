/**
 * The ledger's Web route: one exact GET endpoint returning the day-keyed
 * ledger, with a short read cache so polling tabs share one disk read.
 *
 * These cases drive the route's `fetch` directly against a temporary ledger
 * root; the registration seam is thin enough to assert by shape alone.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendLedgerEntry, closeLedgerHandles } from '../src/ledger-file.ts'
import { WASTE_LEDGER_PATH, createWasteLedgerRoute } from '../src/ledger-server.ts'
import type { LlmWasteEventData } from '../src/types.ts'
import { WasteId } from '../src/brand.ts'

/** Roots created for one test, removed afterwards. */
const cleanup: string[] = []

afterEach(async () => {
  await closeLedgerHandles()
  vi.restoreAllMocks()
  await Promise.all(cleanup.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Create one throwaway ledger root. */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'i-am-rich-'))
  cleanup.push(root)
  return root
}

/** A discard with the minimum shape the writer accepts. */
function waste(day: string, usage?: LlmWasteEventData['usage']): LlmWasteEventData {
  return {
    wasteId: WasteId(`w-${day}-${usage?.inputTokens ?? 0}`),
    provider: 'deepseek',
    model: 'deepseek-chat',
    outcome: 'discarded',
    day,
    ...usage === undefined ? {} : { usage },
  }
}

describe('createWasteLedgerRoute', () => {
  it('declares an exact GET route at the fixed client path', () => {
    const route = createWasteLedgerRoute('/tmp/ledger')

    expect(route.path).toBe(WASTE_LEDGER_PATH)
    expect(route.methods).toEqual(['GET'])
    expect(route.requestBody).toBe('buffered')
  })

  it('answers with the day-keyed ledger and no-store caching', async () => {
    const root = await tempRoot()
    await appendLedgerEntry(root, waste('2026-01-05', { inputTokens: 100, outputTokens: 20 }))
    const route = createWasteLedgerRoute(root)

    const response = await route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      days: { '2026-01-05': { pricedCalls: 1, unpricedCalls: 0, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    })
  })

  it('answers an empty ledger when nothing has been recorded', async () => {
    const route = createWasteLedgerRoute(await tempRoot())

    const response = await route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))

    await expect(response.json()).resolves.toEqual({ days: {} })
  })

  it('serves reads within the cache window without touching the files', async () => {
    const root = await tempRoot()
    await appendLedgerEntry(root, waste('2026-01-05', { inputTokens: 10, outputTokens: 0 }))
    const route = createWasteLedgerRoute(root)
    await route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))

    // A discard the cache has not seen yet must not appear mid-window.
    await appendLedgerEntry(root, waste('2026-01-06', { inputTokens: 20, outputTokens: 0 }))
    const cached = await (await route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))).json()

    expect(Object.keys((cached as { days: Record<string, unknown> }).days)).toEqual(['2026-01-05'])

    // Past the window, the same route serves the newer state.
    vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER / 2)
    const fresh = await (await route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))).json()

    expect(Object.keys((fresh as { days: Record<string, unknown> }).days).sort()).toEqual(['2026-01-05', '2026-01-06'])
  })

  it('rejects with the read error instead of an empty ledger', async () => {
    // A root that is a file makes readdir fail, unlike an absent directory.
    const dir = await tempRoot()
    const root = join(dir, 'as-file')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(root, 'not a directory')
    const route = createWasteLedgerRoute(root)

    await expect(route.fetch(new Request(`http://host${WASTE_LEDGER_PATH}`))).rejects.toThrow()
  })
})

describe('registerWasteLedgerRoute', () => {
  it('declares the connection service so the route is registered, not skipped', async () => {
    // The regression this pins: on a live (activated) plugin fiber, cordis
    // throws `cannot get property "connection" without inject` for a bare
    // `ctx.connection` read. The registration used to catch that throw and
    // report "no Web client", which is indistinguishable from the supported
    // headless shape — so the Desktop app burned and recorded perfectly while
    // the status bar stayed pinned at zero, because the route the client polls
    // was never registered. Declaring `inject` is what makes the read legal.
    const { Context } = await import('@deepseek-ai/cordis')
    const { inject } = await import('../src/index.ts')
    const { registerWasteLedgerRoute } = await import('../src/ledger-server.ts')

    expect(inject).toContain('connection')

    // An activated fiber without the injection really does throw; this is the
    // exact failure the old `catch` swallowed. Activation is asynchronous, so
    // the fiber is awaited before the probe's result is read.
    const root = new Context()
    let threw: string | undefined
    await root.plugin({
      name: 'probe-without-inject',
      apply(ctx: { connection?: unknown }) {
        try {
          void ctx.connection
        } catch (error) {
          threw = (error as Error).message
        }
      },
    } as never)
    expect(threw).toContain('without inject')

    // With the service provided, the route reaches `connection.fetch.register`
    // exactly once and returns a disposer.
    const registered: { path: string }[] = []
    const ctx = new Context()
    ctx.provide('connection', {
      fetch: {
        register: (route: { path: string }) => {
          registered.push(route)
          return async () => {}
        },
      },
    })
    const disposer = registerWasteLedgerRoute(ctx as never, await tempRoot())

    expect(typeof disposer).toBe('function')
    expect(registered.map(route => route.path)).toEqual([WASTE_LEDGER_PATH])
  })

  it('reports a genuinely absent connection instead of throwing', async () => {
    // The headless shape stays supported: no Web client means no route, and
    // the burn plus the ledger must continue regardless.
    const { Context } = await import('@deepseek-ai/cordis')
    const { registerWasteLedgerRoute } = await import('../src/ledger-server.ts')
    const ctx = new Context()

    expect(registerWasteLedgerRoute(ctx as never, await tempRoot())).toBeUndefined()
  })
})
