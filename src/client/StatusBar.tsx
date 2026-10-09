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
import type { ShellBottomProps, WasteLedgerView } from './contracts.ts'
import { sumPeriods } from '../waste.ts'
import type { IAmRichKey } from './locales.ts'

/** Props the shell composes for this contribution. */
export type WasteStatusBarProps = ShellBottomProps

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
 * @param count - the token count to format.
 * @returns the count as localized digits.
 */
function formatTokens(count: number): string {
  return count.toLocaleString()
}

/**
 * Render today's, this month's, and all-time discarded-token totals.
 *
 * Always renders the three periods, including before the first discard has been
 * recorded. The bar is the only signal that the plugin is mounted at all, and
 * `shell.bottom` reserves no space for empty content, so returning nothing
 * until the first waste event would make a correctly-installed plugin
 * indistinguishable from one that failed to load. A session that publishes no
 * ledger folds to zeroes, which is the honest reading of "nothing wasted yet".
 * @param props - the shell's standing seats for a bottom-bar contribution.
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
      role="status"
      aria-label={translate('waste.aria')}
      title={tooltip}
    >
      {PERIODS.map(period => (
        <span key={period} style={FIGURE} data-i-am-rich-period={period} data-calls={calls[period]}>
          <span style={LABEL}>{translate(`period.${period}` as IAmRichKey)}</span>
          <span style={VALUE}>{formatTokens(periods[period])}</span>
          <span style={UNIT}>{translate('waste.unit')}</span>
        </span>
      ))}
    </span>
  )
}