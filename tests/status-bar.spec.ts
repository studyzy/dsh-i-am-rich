/**
 * The waste status bar: it renders the Host projection's figure, stays silent
 * for a session with no ledger, and never invents a number for a day whose
 * discards the provider did not price.
 */

import { describe, expect, it, vi } from 'vitest'
import { WasteStatusBar } from '../src/client/StatusBar.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SessionLike, WasteTodayView } from '../src/client/contracts.ts'

/** A view with one priced day. */
function view(overrides: Partial<WasteTodayView> = {}): WasteTodayView {
  return {
    days: {
      '2026-01-05': {
        pricedCalls: 3,
        unpricedCalls: 0,
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    latestDay: '2026-01-05',
    latestTotal: 1200,
    ...overrides,
  }
}

/**
 * Render the bar with a stubbed session store.
 *
 * The default translator interpolates `{name}` params the way the real `t`
 * seat does, so assertions can read finished copy rather than templates.
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
  return WasteStatusBar({ useSessions, sessionId: 's1', t: translate as never }) as React.ReactElement
}

/** Flatten a React element tree to its text content. */
function textOf(element: React.ReactElement): string {
  const walk = (node: unknown): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(walk).join('')
    const props = (node as { props?: { children?: unknown } }).props
    return props === undefined ? '' : walk(props.children)
  }
  return walk(element)
}

describe('waste status bar', () => {
  it('renders today total from the projection', () => {
    const element = render({ projectionValues: { wasteToday: view() } })

    expect(textOf(element)).toBe('Wasted 1,200 tokens today')
  })

  it('renders Chinese copy through the zh dictionary', () => {
    const translate = (key: keyof typeof zh, params?: Record<string, unknown>) =>
      (zh[key] as string).replace('{tokens}', String(params?.['tokens']))
    const element = render({ projectionValues: { wasteToday: view() } }, translate as never)

    expect(textOf(element)).toBe('咱今天又浪费了 1,200 Token')
  })

  it('renders nothing when the session publishes no ledger', () => {
    expect(render({})).toBeNull()
    expect(render(undefined)).toBeNull()
  })

  it('renders nothing for a malformed projection value', () => {
    expect(render({ projectionValues: { wasteToday: { latestTotal: 'lots' } } })).toBeNull()
  })

  it('reports an empty day rather than a zero total', () => {
    const empty = view({ days: {}, latestDay: undefined, latestTotal: 0 })
    const element = render({ projectionValues: { wasteToday: empty } })

    expect(textOf(element)).toBe('No tokens wasted today')
  })

  it('names unpriced calls in the tooltip instead of counting them as tokens', () => {
    const withUnpriced = view({
      days: {
        '2026-01-05': {
          pricedCalls: 2,
          unpricedCalls: 4,
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      latestTotal: 600,
    })
    const element = render({ projectionValues: { wasteToday: withUnpriced } })

    expect(textOf(element)).toBe('Wasted 600 tokens today')
    expect(element.props.title).toContain('2 calls')
    expect(element.props.title).toContain('4 more calls reported no usage')
  })

  it('searches thousands separators through the locale formatter', () => {
    const spy = vi.spyOn(Number.prototype, 'toLocaleString')
    render({ projectionValues: { wasteToday: view() } })

    expect(spy).toHaveBeenCalledWith()
    spy.mockRestore()
  })
})