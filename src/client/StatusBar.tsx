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
import type { WasteDockProps, WasteLedgerView } from './contracts.ts'
import { sumPeriods, toMagnitude, type MagnitudeUnit } from '../waste.ts'
import { COIN, type IAmRichKey } from './locales.ts'

/** Props the shell composes for this contribution. */
export type WasteStatusBarProps = WasteDockProps

/**
 * Inline styling for the bar.
 *
 * Inline rather than a CSS Module because `tsc` does not copy `.css` into the
 * emit directory, so a stylesheet import would not survive the build that
 * produces the browser bundle. The shared `--dsw-*` tokens are used where they
 * exist so the bar follows the theme.
 */
const BAR: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 14,
  padding: '2px 10px',
  fontSize: 12,
  lineHeight: '18px',
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'none',
  color: 'var(--dsw-text-secondary)',
}

const FIGURE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
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
 * Always renders the three periods, including before the first discard has been
 * recorded. The bar is the only signal that the plugin is mounted at all, and a
 * dock entry that renders nothing is indistinguishable from one that failed to
 * load, so returning nothing until the first waste event would hide the
 * plugin's own presence. A session that publishes no ledger folds to zeroes,
 * which is the honest reading of "nothing wasted yet".
 *
 * The figures are scaled to 万/亿 (or K/M/B under `en`) so a count in the tens of
 * millions reads as `2,249万` rather than a digit string nobody parses at a
 * glance. The tooltip keeps the exact integers, because scaling is a display
 * choice and the ledger is the record.
 * @param props - the shell's standing seats for a dock contribution.
 * @returns the status bar.
 */
export function WasteStatusBar({ useSessions, sessionId, t }: WasteStatusBarProps) {
  const ledger = useSessions(state => asLedger(state.byId[sessionId]?.projectionValues?.['wasteLedger']))
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

  return (
    <span
      style={BAR}
      data-i-am-rich-waste={hasWaste ? 'total' : 'empty'}
      data-i-am-rich-scale={scale}
      role="status"
      aria-label={translate('waste.aria')}
      title={tooltip}
    >
      <span style={COIN_STYLE} data-i-am-rich-coin aria-hidden="true">{COIN}</span>
      {PERIODS.map(period => (
        <span key={period} style={FIGURE} data-i-am-rich-period={period} data-calls={calls[period]}>
          <span style={LABEL}>{translate(`period.${period}` as IAmRichKey)}</span>
          <span style={VALUE}>{figures[period].value}</span>
          <span style={UNIT}>{translate(unitKey(figures[period].unit))}</span>
        </span>
      ))}
    </span>
  )
}