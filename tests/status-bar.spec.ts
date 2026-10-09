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
import { en, zh, COIN } from '../src/client/locales.ts'
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
 * Every figure stays below 1,000 so the bar renders it unscaled, keeping these
 * cases about the fold rather than about magnitude formatting.
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

/**
 * Find the first node in a rendered tree carrying a given prop.
 *
 * Searched depth-first rather than by position: the bar's children include the
 * coin alongside a nested list of period figures, so reaching a figure by index
 * would couple every case to the decorative siblings around it.
 * @param node - the element tree to search.
 * @param prop - the data attribute to match.
 * @returns the matching element, or undefined.
 */
function findByProp(node: unknown, prop: string): React.ReactElement | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, prop)
      if (found !== undefined) return found
    }
    return undefined
  }
  const element = node as React.ReactElement & { props?: Record<string, unknown> }
  if (element.props?.[prop] !== undefined) return element
  return findByProp(element.props?.children, prop)
}

/** Read one period figure's rendered text from the bar. */
function periodText(element: React.ReactElement | null, period: string): string {
  const figures = (element?.props as { children?: unknown })?.children
  const found = (function search(node: unknown): React.ReactElement | undefined {
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = search(child)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    const el = node as React.ReactElement & { props?: Record<string, unknown> }
    if (el.props?.['data-i-am-rich-period'] === period) return el
    return search(el.props?.children)
  })(figures)
  return textOf(found as React.ReactElement)
}

describe('waste status bar', () => {
  it('renders today, this month, and all-time figures', () => {
    const element = render({ projectionValues: { wasteLedger: ledger() } })

    expect(periodText(element, 'today')).toBe('Wasted today100')
    expect(periodText(element, 'month')).toBe('Wasted this month300')
    expect(periodText(element, 'total')).toBe('Wasted all time700')
  })

  it('renders Chinese copy through the zh dictionary', () => {
    const translate = (key: keyof typeof zh, params?: Record<string, unknown>) => {
      const template = zh[key] as string
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
    }
    const element = render({ projectionValues: { wasteLedger: ledger() } }, translate as never)

    expect(periodText(element, 'today')).toBe('今日浪费100')
    expect(periodText(element, 'month')).toBe('本月浪费300')
    expect(periodText(element, 'total')).toBe('累计浪费700')
  })

  it('sums a month that has already rolled over', () => {
    // Everything recorded is older than 40 days, so this month is empty while
    // the all-time figure still counts it.
    const stale: WasteLedgerView = { days: { [dayKey(daysFromToday(-40))]: bucket(400) } }
    const element = render({ projectionValues: { wasteLedger: stale } })

    expect(periodText(element, 'today')).toBe('Wasted today0')
    expect(periodText(element, 'month')).toBe('Wasted this month0')
    expect(periodText(element, 'total')).toBe('Wasted all time400')
  })

  it('shows three zeros when the session publishes no ledger', () => {
    // The bar is the only visible sign the plugin is mounted, and a dock entry
    // that renders nothing is indistinguishable from one that failed to load,
    // so absence must still render.
    for (const session of [{}, undefined]) {
      const element = render(session)

      expect(element?.props['data-i-am-rich-waste']).toBe('empty')
      expect(periodText(element, 'today')).toBe('Wasted today0')
      expect(periodText(element, 'month')).toBe('Wasted this month0')
      expect(periodText(element, 'total')).toBe('Wasted all time0')
    }
  })

  it('shows three zeros for a malformed projection value', () => {
    for (const bad of [{ days: 'nope' }, 7]) {
      const element = render({ projectionValues: { wasteLedger: bad } })

      expect(element?.props['data-i-am-rich-waste']).toBe('empty')
      expect(periodText(element, 'total')).toBe('Wasted all time0')
    }
  })

  it('reports an empty ledger as zeros with an explanatory tooltip', () => {
    const element = render({ projectionValues: { wasteLedger: { days: {} } } })

    expect(element?.props['data-i-am-rich-waste']).toBe('empty')
    expect(element?.props.title).toBe('No tokens wasted yet')
    expect(periodText(element, 'total')).toBe('Wasted all time0')
  })

  it('names unpriced calls in the tooltip instead of counting them as tokens', () => {
    const withUnpriced: WasteLedgerView = {
      days: { [dayKey(daysFromToday(0))]: bucket(600, 2, 4) },
    }
    const element = render({ projectionValues: { wasteLedger: withUnpriced } })

    expect(periodText(element, 'total')).toBe('Wasted all time600')
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
    expect(periodText(element, 'total')).toBe('Wasted all time0')
  })
})

describe('magnitude display', () => {
  /** A ledger whose spend lands entirely on today, at the given size. */
  function spend(tokens: number): WasteLedgerView {
    return { days: { [dayKey(daysFromToday(0))]: bucket(tokens) } }
  }

  /** The zh translator, interpolating params the way the real seat does. */
  const zhT = (key: keyof typeof zh, params?: Record<string, unknown>) => {
    const template = zh[key] as string
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  }

  it('leads with a coin', () => {
    const element = render({ projectionValues: { wasteLedger: spend(100) } })
    const coin = findByProp(element, 'data-i-am-rich-coin')

    expect(coin).toBeDefined()
    expect(textOf(coin as React.ReactElement)).toBe(COIN)
    // Decorative: the accessible name comes from the aria-label, not the glyph.
    expect(coin?.props['aria-hidden']).toBe('true')
  })

  it('scales a six-figure count to 万 in Chinese', () => {
    // 22,488,345 is the real ledger total; it is not yet 亿, so it reads as 万.
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } }, zhT as never)

    expect(periodText(element, 'today')).toBe('今日浪费2249万')
    expect(periodText(element, 'month')).toBe('本月浪费2249万')
    expect(periodText(element, 'total')).toBe('累计浪费2249万')
  })

  it('spells out 浪费 in every Chinese label, not just the period', () => {
    // The bar must say what happened, not merely when: a bare "今日 2249万"
    // reads as a spend figure, which is the opposite of what this plugin counts.
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } }, zhT as never)

    for (const period of ['today', 'month', 'total']) {
      expect(periodText(element, period)).toContain('浪费')
    }
  })

  it('names the waste in every English label too', () => {
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } })

    for (const period of ['today', 'month', 'total']) {
      expect(periodText(element, period)).toContain('Wasted')
    }
  })

  it('scales a nine-figure count to 亿 in Chinese', () => {
    const element = render({ projectionValues: { wasteLedger: spend(250_000_000) } }, zhT as never)

    expect(periodText(element, 'today')).toBe('今日浪费2.5亿')
    expect(periodText(element, 'total')).toBe('累计浪费2.5亿')
  })

  it('uses K/M/B under the English dictionary rather than 万/亿', () => {
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } })

    expect(periodText(element, 'today')).toBe('Wasted today22.49M')
    expect(periodText(element, 'total')).toBe('Wasted all time22.49M')
  })

  it('never renders a bare 0亿 for a figure that is plainly millions', () => {
    // The whole point of picking the largest applicable unit: 22.5M must not be
    // written as "0亿".
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } }, zhT as never)

    expect(periodText(element, 'total')).not.toContain('0亿')
    expect(periodText(element, 'total')).toBe('累计浪费2249万')
  })

  it('keeps the exact integer in the tooltip while the bar is scaled', () => {
    const element = render({ projectionValues: { wasteLedger: spend(22_488_345) } }, zhT as never)

    // Display is scaled; the tooltip is the record.
    expect(periodText(element, 'total')).toBe('累计浪费2249万')
    expect(element?.props.title).toContain('22,488,345')
  })

  it('marks which scale family the bar rendered in', () => {
    const cn = render({ projectionValues: { wasteLedger: spend(100) } }, zhT as never)
    const us = render({ projectionValues: { wasteLedger: spend(100) } })

    expect(cn?.props['data-i-am-rich-scale']).toBe('zh')
    expect(us?.props['data-i-am-rich-scale']).toBe('en')
  })
})