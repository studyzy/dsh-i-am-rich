/**
 * The waste status bar: it renders today, this month, and all-time figures from
 * the Host ledger, stays silent for a session with no ledger, and never invents
 * a number for a day whose discards the provider did not price.
 *
 * The bar computes periods against the real clock, so these cases seed day keys
 * relative to the current date rather than hardcoding a calendar.
 */

import { describe, expect, it } from 'vitest'
import { WasteStatusBar } from '../src/client/StatusBar.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SessionLike, WasteLedgerView, WasteTotals } from '../src/client/contracts.ts'

/** Build a day bucket with the given token count. */
function bucket(inputTokens: number, pricedCalls = 1, unpricedCalls = 0): WasteTotals {
  return {
    pricedCalls,
    unpricedCalls,
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

/** Format a local date the way the ledger keys days. */
function dayKey(at: Date): string {
  const year = String(at.getFullYear()).padStart(4, '0')
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** An instant `offsetDays` away from today, in local time. */
function daysFromToday(offsetDays: number): Date {
  const at = new Date()
  at.setDate(at.getDate() + offsetDays)
  return at
}

/**
 * A ledger with known today, this-month, and all-time figures.
 *
 * Today is +0, so it always falls inside the current month; the older entry is
 * dated 40 days back, which is outside the current month in every calendar.
 */
function ledger(): WasteLedgerView {
  return {
    days: {
      [dayKey(daysFromToday(0))]: bucket(100),
      [dayKey(daysFromToday(-1))]: bucket(200),
      [dayKey(daysFromToday(-40))]: bucket(400),
    },
  }
}

/**
 * Render the bar with a stubbed session store.
 *
 * The default translator interpolates `{name}` params the way the real `t` seat
 * does, so assertions can read finished copy rather than templates.
 * @param session - the active session the selector sees.
 * @param t - translator to use for copy.
 * @returns the rendered React element tree.
 */
function render(session: SessionLike | undefined, t?: (key: keyof typeof en, params?: Record<string, unknown>) => string) {
  const translate = t ?? ((key: keyof typeof en, params?: Record<string, unknown>) => {
    const template = en[key]
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  })
  const useSessions = (<T,>(selector: (state: { byId: Record<string, SessionLike | undefined> }) => T): T =>
    selector({ byId: { s1: session } })) as never
  return WasteStatusBar({ useSessions, sessionId: 's1', t: translate as never }) as React.ReactElement | null
}

/** Flatten a React element tree to its text content. */
function textOf(element: React.ReactElement | null): string {
  const walk = (node: unknown): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(walk).join('')
    const props = (node as { props?: { children?: unknown } }).props
    return props === undefined ? '' : walk(props.children)
  }
  return walk(element)
}

/** Read one period figure's rendered text from the bar. */
function periodText(element: React.ReactElement | null, period: string): string {
  const figures = (element?.props as { children?: unknown })?.children
  const list = Array.isArray(figures) ? figures : [figures]
  const match = list.find(node => (node as { props?: { 'data-i-am-rich-period'?: string } })
    ?.props?.['data-i-am-rich-period'] === period)
  return textOf(match as React.ReactElement)
}

describe('waste status bar', () => {
  it('renders today, this month, and all-time figures', () => {
    const element = render({ projectionValues: { wasteLedger: ledger() } })

    expect(periodText(element, 'today')).toBe('Today100tokens')
    expect(periodText(element, 'month')).toBe('This month300tokens')
    expect(periodText(element, 'total')).toBe('All time700tokens')
  })

  it('renders Chinese copy through the zh dictionary', () => {
    const translate = (key: keyof typeof zh, params?: Record<string, unknown>) => {
      const template = zh[key] as string
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
    }
    const element = render({ projectionValues: { wasteLedger: ledger() } }, translate as never)

    expect(periodText(element, 'today')).toBe('今日100Token')
    expect(periodText(element, 'month')).toBe('本月300Token')
    expect(periodText(element, 'total')).toBe('累计700Token')
  })

  it('sums a month that has already rolled over', () => {
    // Everything recorded is older than 40 days, so this month is empty while
    // the all-time figure still counts it.
    const stale: WasteLedgerView = { days: { [dayKey(daysFromToday(-40))]: bucket(400) } }
    const element = render({ projectionValues: { wasteLedger: stale } })

    expect(periodText(element, 'today')).toBe('Today0tokens')
    expect(periodText(element, 'month')).toBe('This month0tokens')
    expect(periodText(element, 'total')).toBe('All time400tokens')
  })

  it('renders nothing when the session publishes no ledger', () => {
    expect(render({})).toBeNull()
    expect(render(undefined)).toBeNull()
  })

  it('renders nothing for a malformed projection value', () => {
    expect(render({ projectionValues: { wasteLedger: { days: 'nope' } } })).toBeNull()
    expect(render({ projectionValues: { wasteLedger: 7 } })).toBeNull()
  })

  it('reports an empty ledger rather than three zeros', () => {
    const element = render({ projectionValues: { wasteLedger: { days: {} } } })

    expect(textOf(element)).toBe('No tokens wasted yet')
  })

  it('names unpriced calls in the tooltip instead of counting them as tokens', () => {
    const withUnpriced: WasteLedgerView = {
      days: { [dayKey(daysFromToday(0))]: bucket(600, 2, 4) },
    }
    const element = render({ projectionValues: { wasteLedger: withUnpriced } })

    expect(periodText(element, 'total')).toBe('All time600tokens')
    expect(element?.props.title).toContain('2 billed calls')
    expect(element?.props.title).toContain('4 more calls reported no usage')
  })

  it('keeps showing totals when the only records are unpriced', () => {
    const unpricedOnly: WasteLedgerView = {
      days: { [dayKey(daysFromToday(0))]: bucket(0, 0, 3) },
    }
    const element = render({ projectionValues: { wasteLedger: unpricedOnly } })

    // Tokens are zero, but unpriced calls exist, so the bar is not "empty".
    expect(element?.props.title).toContain('3 more calls reported no usage')
    expect(periodText(element, 'total')).toBe('All time0tokens')
  })
})