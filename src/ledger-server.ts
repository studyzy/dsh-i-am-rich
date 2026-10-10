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
import type { WasteTotals } from './waste.ts'
import { readLedgerDays } from './ledger-file.ts'

/** The exact route path the client polls. Fixed: the client build cannot import host modules. */
export const WASTE_LEDGER_PATH = '/api/i-am-rich/waste'

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
export function createWasteLedgerRoute(root: string): WasteLedgerFetchRoute {
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
      return Response.json({ days: cache.days }, { headers: { 'cache-control': 'no-store' } })
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
 * @returns the route's disposer, or `undefined` when there is no connection.
 */
export function registerWasteLedgerRoute(ctx: Context, root: string): (() => Promise<void>) | undefined {
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
  return connection.fetch.register(createWasteLedgerRoute(root))
}
