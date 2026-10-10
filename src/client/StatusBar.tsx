/**
 * The waste status bar: how many tokens this project burned by sending
 * requests twice and throwing the second copy away, shown for today, the
 * current calendar month, and all recorded time.
 *
 * Read-only by construction. The figures are computed from the Host's ledger
 * route, which folds only provider-reported usage, so nothing shown here is
 * estimated — the numbers are what the provider actually billed for copies
 * that were discarded.
 *
 * The bar owns the clock twice over: it polls the route on an interval, and it
 * selects the today/this-month periods against the reader's current date. The
 * ledger publishes days and no periods, because a period depends on when the
 * question is asked.
 */

import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { LedgerStatus, WasteDockProps, WasteLedgerView } from './contracts.ts'
import { WASTE_LEDGER_PATH } from './contracts.ts'
import { sumPeriods, toMagnitude, type MagnitudeUnit } from '../waste.ts'
import { COIN, type IAmRichKey } from './locales.ts'

/** Props the shell composes for this contribution. */
export type WasteStatusBarProps = WasteDockProps

/**
 * Props of the stateless bar.
 *
 * `expanded`, `ledger`, and `status` are passed in rather than read from Hooks
 * so the row's states are ordinary values: the exported component below owns
 * the hover state and the polling, and a test can render any state directly
 * without a DOM. Splitting them this way is what lets the whole test suite
 * stay plain function calls.
 */
export interface WasteStatusBarViewProps {
  /** The shell's seats for this contribution. */
  readonly wide: boolean
  /** Translation seat for this registration's locale namespace. */
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** The last ledger the poll received, when it has received one. */
  readonly ledger?: WasteLedgerView
  /** How the latest poll ended. */
  readonly status: LedgerStatus
  /** Whether the row shows all three periods instead of today alone. */
  readonly expanded: boolean
  /** Pointer entered the row. */
  readonly onEnter: () => void
  /** Pointer left the row. */
  readonly onLeave: () => void
}

/**
 * Inline styling for the bar.
 *
 * Inline rather than a CSS Module because `tsc` does not copy `.css` into the
 * emit directory, so a stylesheet import would not survive the build that
 * produces the browser bundle. The shared `--dsw-*` tokens are used where they
 * exist so the bar follows the theme.
 *
 * No row ever breaks internally: `flexWrap` is off, so a period and its figure
 * stay together and the panel renders exactly as many rows as it has periods.
 * The width pressure is handled by showing today's period alone at rest and
 * stacking the rest on hover, which is why no row has to overflow.
 */
const BAR: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'nowrap',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minWidth: 0,
  padding: '4px 8px 6px',
  fontSize: 12,
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'none',
  color: 'var(--dsw-text-secondary)',
}

/** The collapsed rail is 56px wide, so only the coin and one figure fit. */
const BAR_RAIL: CSSProperties = {
  ...BAR,
  justifyContent: 'center',
  gap: 5,
  padding: '4px 0 6px',
}

/**
 * The expanded panel: three stacked rows, one period each, each led by a coin.
 *
 * Three labelled periods on one line need roughly 330px, which a 264–420px
 * sidebar does not reliably give. Stacking is how the detail fits the column:
 * one period per line needs only the width of the longest single row, so the
 * panel sizes to the sidebar instead of overhanging it.
 *
 * Laid out as a column, so the panel grows downward over the rows below the
 * seat (the account button) rather than sideways over the sidebar's edge. The
 * background keeps it legible where it covers them.
 */
const BAR_EXPANDED: CSSProperties = {
  ...BAR,
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  position: 'relative',
  zIndex: 30,
  width: '100%',
  borderRadius: 'var(--dsw-radius-sm, 4px)',
  background: 'var(--dsw-alias-bg-base, var(--dsw-specific-sidebar-fill))',
  boxShadow: '0 2px 8px rgb(0 0 0 / 18%)',
}

/** The collapsed rail's expanded panel, which is narrower and centers. */
const BAR_EXPANDED_RAIL: CSSProperties = {
  ...BAR_EXPANDED,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px 0 6px',
}

const FIGURE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
  minWidth: 0,
  whiteSpace: 'nowrap',
}

const LABEL: CSSProperties = { opacity: 0.7 }

const VALUE: CSSProperties = {
  color: 'var(--dsw-text-primary)',
  fontWeight: 500,
}

const UNIT: CSSProperties = { opacity: 0.7, fontSize: 11 }

const COIN_STYLE: CSSProperties = { fontSize: 13, lineHeight: '18px' }

/** The periods the bar renders, in display order. */
const PERIODS = ['today', 'month', 'total'] as const

/** One period's display key. */
type PeriodKey = typeof PERIODS[number]

/** Milliseconds between polls of the ledger route. */
const POLL_INTERVAL_MS = 15_000

/**
 * Format a token count with the reader's thousands separators.
 *
 * Used for the tooltip only: on the bar itself a six-figure number is noise,
 * but a reader who hovers is asking for the exact figure and should get it.
 * @param count - the token count to format.
 * @returns the count as localized digits.
 */
function formatTokens(count: number): string {
  return count.toLocaleString()
}

/**
 * The locale key naming one magnitude scale.
 * @param unit - the scale a count was rendered in.
 * @returns the dictionary key for that scale's unit label.
 */
function unitKey(unit: MagnitudeUnit): IAmRichKey {
  return `unit.${unit}` as IAmRichKey
}

/** Narrow one polled ledger body into the view the bar renders. */
function asLedger(value: unknown): WasteLedgerView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const days = (value as Partial<WasteLedgerView>).days
  return typeof days === 'object' && days !== null ? { days } : undefined
}

/**
 * Render today's, this month's, and all-time discarded-token totals.
 *
 * Stateless: the hover state and the polling live in `WasteStatusBar` below.
 * The rows render from `expanded` so both states are testable without a DOM.
 *
 * Always renders something, including before the first discard has been
 * recorded. The bar is the only signal that the plugin is mounted at all, and
 * an entry that renders nothing is indistinguishable from one that failed to
 * load, so returning nothing until the first poll would hide the plugin's own
 * presence. A missing ledger folds to zeroes, which is the honest reading of
 * "nothing wasted yet".
 *
 * The figures are scaled to 万/亿 (or K/M/B under `en`) so a count in the tens of
 * millions reads as `2,249万` rather than a digit string nobody parses at a
 * glance. The tooltip keeps the exact integers, because scaling is a display
 * choice and the ledger is the record.
 *
 * Every period renders as its own row led by a coin. At rest only today's row
 * shows, because the sidebar is 264–420px and three labelled periods side by
 * side need roughly 330px; hovering shows all three, stacked so the panel needs
 * only the width of its longest row. Nothing is ever dropped from the tooltip,
 * which always spells out all three exact counts — plus, on a failed poll, the
 * notice that the figures may be stale rather than silently freezing them.
 * @param props - the ledger, its poll status, and the expansion state.
 * @returns the status bar.
 */
export function WasteStatusBarView({ wide, t, ledger, status, expanded, onEnter, onLeave }: WasteStatusBarViewProps) {
  const translate = t as (key: IAmRichKey, params?: Record<string, unknown>) => string

  // Folded per render so a long-lived tab's periods follow the calendar.
  // The fold is a bounded pass over the recorded days, and the renderer only
  // re-runs this component when the ledger identity changes.
  const periods = sumPeriods(ledger?.days ?? {}, new Date())
  const hasWaste = periods.total > 0 || periods.totalCalls > 0 || periods.unpricedCalls > 0

  // Which scale family the reader groups large numbers by. Taken from the
  // dictionary rather than the language code so the two stay in step: the
  // English entry for 万 is K, and reading 亿 as 亿 under `en` would be worse
  // than reading it as M.
  const scale = translate('waste.scale') === 'en' ? 'en' : 'zh'
  const figures = {
    today: toMagnitude(periods.today, scale),
    month: toMagnitude(periods.month, scale),
    total: toMagnitude(periods.total, scale),
  }

  const calls: Record<PeriodKey, number> = {
    today: periods.todayCalls,
    month: periods.monthCalls,
    total: periods.totalCalls,
  }

  // Which periods the row renders. Resting state is today alone — that is the
  // figure a glance at the sidebar wants, and it is the one that fits without
  // reserving 330px of a 264–420px column. Hovering expands to all three.
  //
  // The collapsed 56px rail is a separate constraint that hovering cannot
  // relieve: three figures do not fit there in any state, so the rail stays on
  // today whether or not the pointer is over it.
  const shown = wide && expanded ? PERIODS : (['today'] as const)

  // The label is dropped only where it cannot fit: the 56px collapsed rail. In
  // the wide column the resting row keeps 「今日浪费」 spelled out, because the
  // whole point of the label is that a bare figure reads as spend.
  const showLabel = wide

  const base = hasWaste
    ? [
      translate('waste.tooltip', {
        today: formatTokens(periods.today),
        month: formatTokens(periods.month),
        total: formatTokens(periods.total),
      }),
      ...periods.totalCalls > 0 ? [translate('waste.calls', { calls: periods.totalCalls })] : [],
      ...periods.unpricedCalls > 0 ? [translate('waste.unpriced', { calls: periods.unpricedCalls })] : [],
    ].join('\n')
    : translate('waste.none')
  const tooltip = status === 'error' ? `${base}\n${translate('waste.stale')}` : base

  // The resting row is the plain sidebar column; the expanded panel is a stack of
  // one-period rows.
  const resting = wide ? BAR : BAR_RAIL
  const style = expanded
    ? (wide ? BAR_EXPANDED : BAR_EXPANDED_RAIL)
    : resting

  return (
    <span
      style={style}
      data-i-am-rich-waste={hasWaste ? 'total' : 'empty'}
      data-i-am-rich-scale={scale}
      data-i-am-rich-wide={wide ? 'true' : 'false'}
      data-i-am-rich-expanded={expanded ? 'true' : 'false'}
      data-i-am-rich-status={status}
      role="status"
      aria-label={translate('waste.aria')}
      title={tooltip}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {shown.map(period => (
        // Each row carries its own coin. Repeating the glyph per period is what
        // makes a stacked panel read as three separate figures rather than one
        // wrapped sentence.
        <span key={period} style={FIGURE} data-i-am-rich-period={period} data-calls={calls[period]}>
          <span style={COIN_STYLE} data-i-am-rich-coin aria-hidden="true">{COIN}</span>
          {showLabel && <span style={LABEL}>{translate(`period.${period}` as IAmRichKey)}</span>}
          <span style={VALUE}>{figures[period].value}</span>
          <span style={UNIT}>{translate(unitKey(figures[period].unit))}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * The waste bar the shell mounts: the view above, plus the hover state and the
 * ledger poll.
 *
 * A Hook rather than a `:hover` CSS rule because the number of periods is a
 * render decision — a selector can restyle a node but cannot add the month and
 * all-time figures — and because the shell's own foot controls (the account
 * menu) track hover the same way, so the bar behaves like the chrome around it.
 *
 * The ledger arrives by polling the Host route: one immediate fetch on mount,
 * a re-fetch on the interval, and one more whenever the tab becomes visible
 * again (a background tab's timer may have been throttled). A failed poll
 * keeps the last good ledger and flips the status, so the figures freeze
 * visibly instead of silently. The route returns `cache-control: no-store`,
 * so no extra cache-busting is needed.
 * @param props - the shell's standing seats for a footer contribution.
 * @returns the status bar.
 */
export function WasteStatusBar(props: WasteStatusBarProps) {
  const [expanded, setExpanded] = useState(false)
  const [ledger, setLedger] = useState<WasteLedgerView | undefined>(undefined)
  const [status, setStatus] = useState<LedgerStatus>('loading')
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(WASTE_LEDGER_PATH, { signal: controller.signal })
        if (!response.ok) throw new Error(`ledger route answered ${String(response.status)}`)
        const body: unknown = await response.json()
        if (!alive.current) return
        setLedger(asLedger(body))
        setStatus('ok')
      } catch {
        if (!alive.current || controller.signal.aborted) return
        setStatus('error')
      }
    }

    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <WasteStatusBarView
      {...props}
      ledger={ledger}
      status={status}
      expanded={expanded}
      onEnter={() => setExpanded(true)}
      onLeave={() => setExpanded(false)}
    />
  )
}
