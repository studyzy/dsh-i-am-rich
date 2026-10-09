/**
 * The waste status bar: how many tokens this project burned by sending
 * requests twice and throwing the second copy away, shown for today, the
 * current calendar month, and all recorded time.
 *
 * Read-only by construction. The figures are computed from the Host's
 * `wasteLedger` projection, which folds only provider-reported usage, so
 * nothing shown here is estimated — the numbers are what the provider actually
 * billed for copies that were discarded.
 *
 * The bar owns the clock. The ledger publishes days and no periods, because a
 * period depends on the reader's current date; selecting today's day and this
 * month's prefix here is what keeps the durable projection replay-exact.
 */

import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { WasteDockProps, WasteLedgerView, SessionsState } from './contracts.ts'
import { sumPeriods, toMagnitude, type MagnitudeUnit } from '../waste.ts'
import { COIN, type IAmRichKey } from './locales.ts'

/** Props the shell composes for this contribution. */
export type WasteStatusBarProps = WasteDockProps

/**
 * Props of the stateless bar.
 *
 * `expanded` is passed in rather than read from a Hook so the row's two states
 * are ordinary values: the exported component below owns the hover state, and a
 * test can render either state directly without a DOM. Splitting them this way
 * is what lets the whole test suite stay plain function calls.
 */
export interface WasteStatusBarViewProps extends WasteDockProps {
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

/** Narrow the projection value the Host publishes for this plugin. */
function asLedger(value: unknown): WasteLedgerView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const days = (value as Partial<WasteLedgerView>).days
  return typeof days === 'object' && days !== null ? { days } : undefined
}

/**
 * Pick the session the main view is showing.
 *
 * This seat is root-scope, so the shell passes no `sessionId`; the selection has
 * to come out of the store. `retainedBy.mainView > 0` is the shell's own test
 * for "the main view is displaying this session" — `ui-layout` selects the
 * document title exactly this way — so the bar follows the same definition
 * rather than inventing a second one.
 * @param state - the session store snapshot.
 * @returns the active session's id, or undefined when none is retained.
 */
function activeSessionId(state: SessionsState): string | undefined {
  return Object.entries(state.byId)
    .find(([, session]) => (session?.retainedBy?.mainView ?? 0) > 0)
    ?.[0]
}

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

/**
 * Render today's, this month's, and all-time discarded-token totals.
 *
 * Stateless: the hover state lives in `WasteStatusBar` below. The rows render
 * from `expanded` so both states are testable without a DOM.
 *
 * Always renders something, including before the first discard has been
 * recorded. The bar is the only signal that the plugin is mounted at all, and an
 * entry that renders nothing is indistinguishable from one that failed to load,
 * so returning nothing until the first waste event would hide the plugin's own
 * presence. A session that publishes no ledger folds to zeroes, which is the
 * honest reading of "nothing wasted yet".
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
 * which always spells out all three exact counts.
 *
 * The rows and the tooltip overlap on hover but are not redundant: the rows are
 * scaled (`2249万`) and the tooltip is the ledger (`22,488,345`), plus the
 * billed-call counts the rows never show.
 * @param props - the shell's standing seats, plus the expansion state and its handlers.
 * @returns the status bar.
 */
export function WasteStatusBarView({ useSessions, wide, t, expanded, onEnter, onLeave }: WasteStatusBarViewProps) {
  const ledger = useSessions(state => asLedger(state.byId[activeSessionId(state) ?? '']?.projectionValues?.['wasteLedger']))
  const translate = t as (key: IAmRichKey, params?: Record<string, unknown>) => string

  // Folded per render so a long-lived session's periods follow the calendar.
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

  const tooltip = hasWaste
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
 * The waste bar the shell mounts: the view above, plus the hover state.
 *
 * A Hook rather than a `:hover` CSS rule because the number of periods is a
 * render decision — a selector can restyle a node but cannot add the month and
 * all-time figures — and because the shell's own foot controls (the account
 * menu) track hover the same way, so the bar behaves like the chrome around it.
 * @param props - the shell's standing seats for a footer contribution.
 * @returns the status bar.
 */
export function WasteStatusBar(props: WasteStatusBarProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <WasteStatusBarView
      {...props}
      expanded={expanded}
      onEnter={() => setExpanded(true)}
      onLeave={() => setExpanded(false)}
    />
  )
}
