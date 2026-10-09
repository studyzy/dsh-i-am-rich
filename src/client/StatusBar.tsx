/**
 * The waste status bar: how many tokens this project burned today by sending
 * requests twice and throwing the second copy away.
 *
 * Read-only by construction. The figure comes from the Host's `wasteToday`
 * projection, which folds only provider-reported usage, so nothing shown here
 * is estimated — the number is what the provider actually billed for copies
 * that were discarded.
 */

import type { CSSProperties } from 'react'
import type { ShellBottomProps, WasteTodayView } from './contracts.ts'
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
  padding: '2px 10px',
  fontSize: 12,
  lineHeight: '18px',
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'none',
  color: 'var(--dsw-text-secondary)',
}

const BAR_ACTIVE: CSSProperties = { ...BAR, color: 'var(--dsw-text-primary)' }

/** Narrow the projection value the Host publishes for this plugin. */
function asWasteView(value: unknown): WasteTodayView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<WasteTodayView>
  return typeof candidate.latestTotal === 'number' && typeof candidate.days === 'object'
    ? candidate as WasteTodayView
    : undefined
}

/** Format a token count with thousands separators for readability. */
function formatTokens(count: number): string {
  return count.toLocaleString()
}

/**
 * Render today's discarded-token total for the active session.
 * @param props - the shell's standing seats for a bottom-bar contribution.
 * @returns the status text, or null when no session publishes a ledger.
 */
export function WasteStatusBar({ useSessions, sessionId, t }: WasteStatusBarProps) {
  const view = useSessions(state => asWasteView(state.byId[sessionId]?.projectionValues?.['wasteToday']))
  if (view === undefined) return null

  const totals = view.latestDay === undefined ? undefined : view.days[view.latestDay]
  const translate = t as (key: IAmRichKey, params?: Record<string, unknown>) => string

  if (totals === undefined || view.latestTotal === 0) {
    return <span style={BAR} data-i-am-rich-waste="empty">{translate('waste.none')}</span>
  }

  const tooltip = [
    translate('waste.todayTooltip', { calls: totals.pricedCalls }),
    ...totals.unpricedCalls > 0 ? [translate('waste.unpriced', { calls: totals.unpricedCalls })] : [],
  ].join('\n')

  return (
    <span style={BAR_ACTIVE} data-i-am-rich-waste="total" title={tooltip}>
      {translate('waste.today', { tokens: formatTokens(view.latestTotal) })}
    </span>
  )
}