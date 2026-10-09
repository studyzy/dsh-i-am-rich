/**
 * The waste status bar: it renders today, this month, and all-time figures from
 * the Host ledger, stays silent for a session with no ledger, and never invents
 * a number for a day whose discards the provider did not price.
 *
 * The bar computes periods against the real clock, so these cases seed day keys
 * relative to the current date rather than hardcoding a calendar.
 */

import { describe, expect, it } from 'vitest'
import { WasteStatusBarView } from '../src/client/StatusBar.tsx'
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
 *
 * The seat is `sidebar.footer.action`, a root-scope slot: the shell passes no
 * `sessionId`, so the session is selected from the store by `retainedBy.mainView`
 * — the same idiom `ui-layout` uses for the document title. The stub therefore
 * marks the session as retained unless a case is specifically about selection.
 *
 * Rendered through the stateless view with an explicit `expanded`, so the resting
 * and hovered rows are both reachable as plain function calls. The exported
 * `WasteStatusBar` only adds the hover state around this. `expanded` defaults to
 * true so the figure and copy cases can read all three periods; the layout cases
 * pass it explicitly to cover both states.
 * @param session - the active session the selector sees.
 * @param t - translator to use for copy.
 * @param wide - whether the sidebar is in its wide column.
 * @param expanded - whether the row is hovered open.
 * @returns the rendered React element tree.
 */
function render(
  session: SessionLike | undefined,
  t?: (key: keyof typeof en, params?: Record<string, unknown>) => string,
  wide = true,
  expanded = true,
) {
  const translate = t ?? ((key: keyof typeof en, params?: Record<string, unknown>) => {
    const template = en[key]
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  })
  const useSessions = (<T,>(selector: (state: { byId: Record<string, SessionLike | undefined> }) => T): T =>
    selector({ byId: { s1: withMainView(session) } })) as never
  return WasteStatusBarView({
    useSessions,
    wide,
    expanded,
    onEnter: () => {},
    onLeave: () => {},
    t: translate as never,
  }) as React.ReactElement | null
}

/**
 * Mark a session as retained by the main view.
 *
 * The bar selects its session by that counter, so a fixture without it would
 * read as "no active session" and silently show zeroes.
 * @param session - the session fixture.
 * @returns the session with the main-view retention set.
 */
function withMainView(session: SessionLike | undefined): SessionLike | undefined {
  return session === undefined ? undefined : { ...session, retainedBy: { mainView: 1 } }
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

/**
 * The bar's direct children.
 *
 * The layout lives on the element's own style, so asserting "one row" means
 * looking at exactly the cells the bar places in that row — not at the tree
 * flattened, which would not distinguish one row from four.
 * @param element - the rendered bar.
 * @returns its direct child elements.
 */
function childrenOf(element: React.ReactElement | null): (React.ReactElement & { props: Record<string, unknown> })[] {
  const children = (element?.props as { children?: unknown })?.children
  const list = Array.isArray(children) ? children : [children]
  return list.flat().filter((child): child is React.ReactElement & { props: Record<string, unknown> } =>
    child !== null && child !== undefined && typeof child === 'object')
}

/**
 * Read one period figure's rendered text from the bar.
 *
 * The leading coin is skipped: every row carries one, and these assertions are
 * about the label, the figure and the unit. Assertions about the coin itself
 * go through `findByProp`/`coinsOf`.
 * @param element - the rendered bar.
 * @param period - the period to read.
 * @returns the row's text without its coin.
 */
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
  const row = found as React.ReactElement & { props?: { children?: unknown } }
  const parts = Array.isArray(row?.props?.children) ? row.props.children : [row?.props?.children]
  return parts
    .flat()
    .filter(child => (child as { props?: Record<string, unknown> })?.props?.['data-i-am-rich-coin'] === undefined)
    .map(child => textOf(child as React.ReactElement))
    .join('')
}

/**
 * Every coin rendered in the bar, in document order.
 * @param element - the rendered bar.
 * @returns one entry per rendered coin.
 */
function coinsOf(element: React.ReactElement | null): React.ReactElement[] {
  const found: React.ReactElement[] = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const el = node as React.ReactElement & { props?: Record<string, unknown> }
    if (el.props?.['data-i-am-rich-coin'] !== undefined) found.push(el)
    walk(el.props?.children)
  }
  walk((element?.props as { children?: unknown })?.children)
  return found
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

describe('session selection without a sessionId seat', () => {
  /**
   * Render over a raw store, bypassing the helper's main-view marking.
   *
   * The bar is a root-scope sidebar contribution, so it must find the active
   * session itself rather than being handed one.
   * @param byId - the store's session map.
   * @returns the rendered React element tree.
   */
  function renderStore(byId: Record<string, SessionLike | undefined>) {
    const useSessions = (<T,>(selector: (state: { byId: Record<string, SessionLike | undefined> }) => T): T =>
      selector({ byId })) as never
    return WasteStatusBarView({
      useSessions,
      wide: true,
      expanded: true,
      onEnter: () => {},
      onLeave: () => {},
      t: ((key: keyof typeof en) => en[key]) as never,
    }) as React.ReactElement | null
  }

  /** A session carrying a ledger, optionally retained by the main view. */
  function session(tokens: number, mainView: number): SessionLike {
    return {
      retainedBy: { mainView },
      projectionValues: { wasteLedger: { days: { [dayKey(daysFromToday(0))]: bucket(tokens) } } },
    }
  }

  it('reads the ledger of the session the main view retains', () => {
    const element = renderStore({ a: session(100, 0), b: session(700, 1) })

    expect(periodText(element, 'total')).toBe('Wasted all time700')
  })

  it('ignores a retained-but-zero session in favour of the shown one', () => {
    // `mainView > 0` is the shell's own test for "the main view shows this";
    // a counter of 0 means some other surface retains it.
    const element = renderStore({ background: session(500, 0), shown: session(300, 1) })

    expect(periodText(element, 'total')).toBe('Wasted all time300')
  })

  it('folds to zeroes when no session is retained by the main view', () => {
    const element = renderStore({ a: session(100, 0) })

    expect(element?.props['data-i-am-rich-waste']).toBe('empty')
    expect(periodText(element, 'total')).toBe('Wasted all time0')
  })

  it('folds to zeroes for a session whose retainedBy is missing', () => {
    const element = renderStore({ a: { projectionValues: { wasteLedger: { days: {} } } } })

    expect(element?.props['data-i-am-rich-waste']).toBe('empty')
    expect(periodText(element, 'total')).toBe('Wasted all time0')
  })
})

describe('sidebar rail', () => {
  /** The zh translator, interpolating params the way the real seat does. */
  const zhT = (key: keyof typeof zh, params?: Record<string, unknown>) => {
    const template = zh[key] as string
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''))
  }

  /** A ledger whose spend lands entirely on today. */
  const ledger: WasteLedgerView = { days: { [dayKey(daysFromToday(0))]: bucket(22_488_345) } }

  it('marks whether it rendered in the wide column', () => {
    const wide = render({ projectionValues: { wasteLedger: ledger } }, undefined, true)
    const rail = render({ projectionValues: { wasteLedger: ledger } }, undefined, false)

    expect(wide?.props['data-i-am-rich-wide']).toBe('true')
    expect(rail?.props['data-i-am-rich-wide']).toBe('false')
  })

  it('shows today alone at rest, on one row with one coin', () => {
    // Resting state is a single period, so it never has to fit ~330px into a
    // 264–420px sidebar.
    const element = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, false)

    expect(element?.props['data-i-am-rich-expanded']).toBe('false')
    expect(periodText(element, 'today')).toBe('今日浪费2249万')

    const rows = childrenOf(element)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.props['data-i-am-rich-period']).toBe('today')

    const style = element?.props.style as Record<string, unknown>
    expect(style.flexDirection).toBe('row')
    expect(coinsOf(element)).toHaveLength(1)
  })

  it('expands into three stacked rows, each with its own coin', () => {
    // The requested shape: three lines, not three columns, and a coin leading
    // every line rather than one coin for the whole panel.
    const element = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, true)

    expect(element?.props['data-i-am-rich-expanded']).toBe('true')
    expect(periodText(element, 'today')).toBe('今日浪费2249万')
    expect(periodText(element, 'month')).toBe('本月浪费2249万')
    expect(periodText(element, 'total')).toBe('累计浪费2249万')

    // One row per period, stacked, in order.
    const rows = childrenOf(element)
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.props['data-i-am-rich-period'])).toEqual(['today', 'month', 'total'])

    const style = element?.props.style as Record<string, unknown>
    expect(style.flexDirection).toBe('column')

    // A coin per row, not a single shared one.
    expect(coinsOf(element)).toHaveLength(3)
    for (const row of rows) {
      const coins = coinsOf(row as React.ReactElement)
      expect(coins).toHaveLength(1)
      expect(textOf(coins[0] as React.ReactElement)).toBe(COIN)
    }
  })

  it('expands on pointer enter and collapses on pointer leave', () => {
    // The handlers are the contract with the stateful wrapper: a row that never
    // fires them would stay stuck in one of the two states.
    let entered = 0
    let left = 0
    const useSessions = (<T,>(selector: (state: { byId: Record<string, SessionLike | undefined> }) => T): T =>
      selector({ byId: {} })) as never
    const view = WasteStatusBarView({
      useSessions,
      wide: true,
      expanded: false,
      onEnter: () => { entered += 1 },
      onLeave: () => { left += 1 },
      t: zhT as never,
    }) as React.ReactElement

    ;(view.props.onMouseEnter as () => void)()
    ;(view.props.onMouseLeave as () => void)()

    expect(entered).toBe(1)
    expect(left).toBe(1)
  })

  it('shows today alone in the rail, with the other periods kept in the tooltip', () => {
    // The collapsed rail is 56px; the label goes too, since a label plus a
    // figure cannot fit. The tooltip keeps all three exact counts. Checked
    // expanded as well, because the rail has no room for three lines either
    // way — the width limit bites before the hover state does.
    for (const expanded of [false, true]) {
      const rail = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, false, expanded)

      expect(periodText(rail, 'today')).toBe('2249万')

      const rows = childrenOf(rail)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.props['data-i-am-rich-period']).toBe('today')
    }

    const rail = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, false)
    expect(rail?.props.title).toContain('今日浪费')
    expect(rail?.props.title).toContain('本月浪费')
    expect(rail?.props.title).toContain('累计浪费')
  })

  it('never wraps a row onto a second line', () => {
    // Each row is one period and must stay on one line. `flexWrap: 'wrap'`
    // would let a row break internally, which is not what "three rows" means.
    for (const wide of [true, false]) {
      for (const expanded of [true, false]) {
        const element = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, wide, expanded)
        const style = element?.props.style as Record<string, unknown>

        expect(style.flexWrap).toBe('nowrap')
        // The container stacks when expanded and lays out a single row when not.
        expect(style.flexDirection).toBe(expanded ? 'column' : 'row')
      }
    }
  })

  it('stacks the expanded panel within the column instead of overhanging it', () => {
    // Stacking is what makes the detail fit: one period per line needs only the
    // width of the longest single row, so the panel stays inside the sidebar
    // column rather than having to be sized to its content and overflow.
    const resting = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, false)
    const expanded = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, true)
    const restingStyle = resting?.props.style as Record<string, unknown>
    const expandedStyle = expanded?.props.style as Record<string, unknown>

    expect(restingStyle.width).toBe('100%')
    expect(restingStyle.position).toBeUndefined()
    expect(expandedStyle.width).toBe('100%')
    expect(expandedStyle.position).toBe('relative')
    expect(expandedStyle.flexDirection).toBe('column')
  })

  it('keeps the 浪费 labels in the wide column', () => {
    const wide = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, true)

    expect(periodText(wide, 'today')).toBe('今日浪费2249万')
    expect(periodText(wide, 'total')).toBe('累计浪费2249万')
  })

  it('keeps the 浪费 label on the resting row too', () => {
    // Only the number of periods changes between states — the label must not be
    // dropped, or the resting row would read as spend rather than waste.
    const resting = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, false)

    expect(periodText(resting, 'today')).toBe('今日浪费2249万')
  })

  it('renders the coin in both widths', () => {
    for (const wide of [true, false]) {
      const element = render({ projectionValues: { wasteLedger: ledger } }, undefined, wide)

      expect(textOf(findByProp(element, 'data-i-am-rich-coin') as React.ReactElement)).toBe(COIN)
    }
  })

  it('keeps each figure atomic so the row does not break mid-figure', () => {
    const element = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, true, true)

    for (const cell of childrenOf(element)) {
      const cellStyle = cell.props.style as Record<string, unknown> | undefined
      if (cellStyle?.whiteSpace !== undefined) expect(cellStyle.whiteSpace).toBe('nowrap')
    }
  })

  it('centers the single row in the rail instead of left-aligning it', () => {
    // The rail always renders one row — hovering cannot widen 56px — so both
    // states center, and the expanded rail panel centers its single row too.
    for (const expanded of [false, true]) {
      const rail = render({ projectionValues: { wasteLedger: ledger } }, zhT as never, false, expanded)
      const style = rail?.props.style as Record<string, unknown>

      expect(style.justifyContent).toBe('center')
      expect(style.flexDirection).toBe(expanded ? 'column' : 'row')
      expect(style.alignItems).toBe('center')
    }
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