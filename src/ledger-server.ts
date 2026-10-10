/**
 * The ledger's Web route: one exact GET endpoint the browser status bar
 * polls for the day-keyed ledger.
 *
 * The route replaces the session projection the ledger used to publish
 * through: the ledger now lives outside the session log, so the wire is an
 * ordinary authenticated Fetch route on the shared `/api` channel. The route
 * owns a tiny read cache so several polling tabs share one disk read instead
 * of multiplying them.
 */

import type { Context } from '@deepseek-ai/cordis'
import { FORTUNE_TIERS, type FortuneTier } from './types.ts'
import type { WasteTotals } from './waste.ts'
import { readLedgerDays } from './ledger-file.ts'

/** The exact route path the client polls. Fixed: the client build cannot import host modules. */
export const WASTE_LEDGER_PATH = '/api/i-am-rich/waste'

/**
 * The exact route the client POSTs a fortune-tier change to.
 *
 * Separate from {@link WASTE_LEDGER_PATH} because the two have different
 * methods and different failure meanings: a failed poll means "these figures
 * may be stale", a failed write means "your choice was not saved".
 */
export const FORTUNE_PATH = '/api/i-am-rich/fortune'

/** The shape a fortune write accepts and answers with. */
export interface FortunePayload {
  /** The tier the client is asking for. */
  readonly fortune: string
}

/** The subset of `ctx.connection` this route registers through. */
export interface WasteLedgerConnection {
  /** Exact Fetch routes on the shared authenticated `/api` channel. */
  readonly fetch: {
    /**
     * Register one exact route.
     * @param route - path, methods, and Fetch-shaped implementation.
     * @returns asynchronous disposer removing the route.
     */
    register(route: WasteLedgerFetchRoute): () => Promise<void>
  }
}

/** Shape of one Fetch route, mirroring the harness's `ConnectionFetchRoute`. */
export interface WasteLedgerFetchRoute {
  /** Absolute path below `/api`. */
  readonly path: string
  /** Methods this route owns. */
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
  /** Buffered requests obey the configured JSON cap. */
  readonly requestBody: 'buffered' | 'streaming'
  /** Handle one authenticated request. */
  readonly fetch: (request: Request) => Promise<Response>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport, as this plugin consumes it. */
    connection: WasteLedgerConnection
  }
}

/** How long a read result is reused before the files are consulted again. */
const CACHE_TTL_MS = 1_000

/**
 * Build the ledger Fetch route without registering it.
 *
 * Split from {@link registerWasteLedgerRoute} so tests can drive `fetch`
 * directly against a temporary ledger root.
 * @param root - ledger root directory to read from.
 * @returns the route definition for `connection.fetch.register`.
 */
export function createWasteLedgerRoute(root: string, fortune?: () => FortuneTier): WasteLedgerFetchRoute {
  let cache: { readonly days: Record<string, WasteTotals>; readonly readAt: number } | undefined
  return {
    path: WASTE_LEDGER_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (_request: Request): Promise<Response> => {
      const now = Date.now()
      if (cache === undefined || now - cache.readAt >= CACHE_TTL_MS) {
        // An absent or unreadable ledger is an error the client must see as an
        // error, not as an empty ledger that would silently reset the bar.
        cache = { days: await readLedgerDays(root), readAt: now }
      }
      // The tier is read per request rather than cached with the days: the
      // days are an expensive disk fold, the tier is a field already in memory,
      // and a cached tier would leave the radio group showing the old choice
      // for up to a second after a change.
      return Response.json(
        { days: cache.days, ...fortune === undefined ? {} : { fortune: fortune() } },
        { headers: { 'cache-control': 'no-store' } },
      )
    },
  }
}

/**
 * Register the ledger route on the shared `/api` channel.
 *
 * Connection absence (a harness without the Web client) is a supported shape:
 * the ledger keeps burning and writing, only the route is missing, and the
 * condition is reported once rather than failing the plugin.
 * @param ctx - plugin context owning the route registration.
 * @param root - ledger root directory to read from.
 * @param fortune - reads the tier currently in effect, reported alongside the days.
 * @returns the route's disposer, or `undefined` when there is no connection.
 */
export function registerWasteLedgerRoute(ctx: Context, root: string, fortune?: () => FortuneTier): (() => Promise<void>) | undefined {
  // `connection` is declared in this plugin's `inject`, so cordis has already
  // resolved it by the time `apply` runs and this read cannot throw. A missing
  // service is therefore a composition error worth surfacing, not something to
  // swallow: masking it once hid an unregistered route behind a perfectly
  // healthy ledger, and the status bar showed zero forever.
  const connection: WasteLedgerConnection | undefined = ctx.connection
  if (connection === undefined) {
    ctx.logger.warn('i-am-rich: no connection service, so the waste status bar has no route to poll; burning and recording continue.')
    return undefined
  }
  return connection.fetch.register(createWasteLedgerRoute(root, fortune))
}

/** Persist one fortune tier through the harness configuration editor. */
export type FortuneWriter = (fortune: FortuneTier) => Promise<void>

/**
 * Build the fortune route without registering it.
 *
 * The route is a thin adapter over {@link FortuneWriter}: all of the real work
 * — locking the profile document, validating the next config, reloading the
 * plugin, and rolling back if the reload fails — belongs to the harness
 * `configEditor` service, and this only translates HTTP to that call.
 *
 * An unknown tier is rejected with 400 rather than being coerced or ignored:
 * the client's radio group is the only intended caller, so a value outside the
 * known set means a bug or a hand-rolled request, and answering 200 would let
 * the bar report a tier that is not the one in effect.
 * @param write - persists one validated tier.
 * @returns the route definition for `connection.fetch.register`.
 */
export function createFortuneRoute(write: FortuneWriter): WasteLedgerFetchRoute {
  return {
    path: FORTUNE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: 'expected a JSON body' }, { status: 400 })
      }
      const fortune = (body as Partial<FortunePayload> | null)?.fortune
      if (typeof fortune !== 'string' || !FORTUNE_TIERS.includes(fortune as FortuneTier)) {
        return Response.json({ error: `fortune must be one of ${FORTUNE_TIERS.join(', ')}` }, { status: 400 })
      }
      try {
        await write(fortune as FortuneTier)
      } catch (error) {
        // The editor's failure is the user's answer: the choice was not saved.
        // Reporting it as 200 would let the radio group show a tier the profile
        // does not hold, which is exactly the lie this plugin exists to avoid.
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
      }
      return Response.json({ fortune }, { headers: { 'cache-control': 'no-store' } })
    },
  }
}

/**
 * Register the fortune route on the shared `/api` channel.
 * @param ctx - plugin context owning the route registration.
 * @param write - persists one validated tier.
 * @returns the route's disposer, or `undefined` when there is no connection.
 */
export function registerFortuneRoute(ctx: Context, write: FortuneWriter): (() => Promise<void>) | undefined {
  const connection: WasteLedgerConnection | undefined = ctx.connection
  if (connection === undefined) return undefined
  return connection.fetch.register(createFortuneRoute(write))
}
