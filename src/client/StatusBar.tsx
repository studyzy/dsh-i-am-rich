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
import type { FortuneTier, FortuneWriteStatus, LedgerStatus, WasteDockProps, WasteLedgerView } from './contracts.ts'
import { FORTUNE_PATH, FORTUNE_TIERS, WASTE_LEDGER_PATH } from './contracts.ts'
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
  /** The fortune tier the Host confirmed, when it reported one. */
  readonly fortuneTier?: FortuneTier
  /** How the last tier write ended. */
  readonly fortuneStatus: FortuneWriteStatus
  /** A tier was chosen in the picker; the wrapper persists it. */
  readonly onFortune: (tier: FortuneTier) => void
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
 *
 * The type scale and colours are transcribed from the account button this row
 * sits directly above (`dsh-client-ui-settings-account`'s `AccountMenu`): the
 * same 14px/22px type, the same 6px padding, and the same
 * `--dsw-alias-label-primary`. The row is a peer of the user name, and it read
 * as a dim caption while it was smaller (12px) and greyer than that.
 */
const BAR: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'nowrap',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minWidth: 0,
  padding: '6px',
  fontSize: 14,
  lineHeight: '22px',
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'none',
  color: 'var(--dsw-alias-label-primary, var(--dsw-text-secondary))',
}

/**
 * The collapsed rail: 56px wide, so only the coin and one figure fit.
 *
 * The label "今日浪费" is dropped here — it cannot fit in 56px — but the
 * trailing "Token" stays: the rail still has to say *what* the figure counts,
 * since a bare "2249万" with no unit reads as a money amount. The row is
 * `nowrap` and centers, so the figure keeps its width rather than reflowing.
 */
const BAR_RAIL: CSSProperties = {
  ...BAR,
  justifyContent: 'center',
  gap: 5,
  padding: '6px 0',
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
  padding: '6px 0',
}

const FIGURE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
  minWidth: 0,
  whiteSpace: 'nowrap',
}

/**
 * The period label ("今日浪费").
 *
 * Full opacity and the account button's own label colour, not a faded one:
 * at 0.7 opacity the label read as a dim caption next to the user name rather
 * than the peer of it that it is. The figure beside it keeps the stronger
 * `--dsw-text-primary`/500 weight, so the row still leads with the number.
 */
const LABEL: CSSProperties = { color: 'var(--dsw-alias-label-primary, inherit)' }

const VALUE: CSSProperties = {
  color: 'var(--dsw-text-primary)',
  fontWeight: 500,
}

const UNIT: CSSProperties = { opacity: 0.7, fontSize: 12 }

/**
 * The trailing "Token" naming what the figure counts.
 *
 * The magnitude unit alone (万 / 亿, or K / M / B) says how big the number is
 * but not what it is a number *of*: "今日浪费 2249万" reads as a money amount,
 * which is precisely the reading this bar exists to prevent. Naming the unit
 * keeps the row honest about counting tokens.
 *
 * Separated from the magnitude by a leading margin of its own rather than by
 * widening the row's shared `gap`, for the same reason the coin carries its own
 * spacing: `gap` is shared by all four children, so raising it would re-space
 * the whole row to fix one seam. Italic-free, but held at the dimmer `UNIT`
 * weight because it is a noun label, not part of the number.
 */
const TOKEN_UNIT: CSSProperties = { opacity: 0.7, fontSize: 12, marginLeft: 4 }

/**
 * The coin, sized to the row's own type so it reads as part of the sentence.
 *
 * `1em` rather than a pixel value: the glyph then tracks the row's font size,
 * so it stays the same size as the label it leads instead of drifting whenever
 * the row is resized. `lineHeight` is left to inherit for the same reason.
 *
 * The extra `marginRight` widens the coin-to-label gap only. The row's own
 * `gap` is shared by every child, so raising it would also push the label away
 * from the figure and the figure away from its unit — three gaps widened to
 * fix one. A margin on the glyph keeps that one seam deliberate, and it is the
 * glyph's own spacing rather than a literal space inside {@link COIN}, so the
 * character stays clean for the tooltip, for copying, and for tests.
 */
const COIN_STYLE: CSSProperties = { fontSize: '1em', marginRight: 3 }

/**
 * The fortune picker's own block, above the periods in the expanded panel.
 *
 * It sits inside the expanded panel rather than in the resting row because it
 * is a control, not a figure: the resting row is a readout, and a set of radio
 * buttons in it would compete with the number the row exists to show. A
 * separator line is what keeps it from reading as a fourth period once the
 * panel is open.
 */
const PICKER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  width: '100%',
  paddingBottom: 4,
  marginBottom: 2,
  borderBottom: '1px solid var(--dsw-alias-border-subtle, rgb(128 128 128 / 25%))',
}

const PICKER_LEGEND: CSSProperties = { opacity: 0.7, fontSize: 12 }

/**
 * The row holding the two tier options side by side.
 *
 * A row of its own inside the picker's column: the legend and the status line
 * belong on their own lines, but the two choices are a single either/or and
 * read as one control only when they sit next to each other. It wraps rather
 * than clips, so a narrow sidebar stacks them back into two lines instead of
 * pushing the second option outside the column.
 */
const PICKER_OPTIONS: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
}

const PICKER_OPTION: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

/**
 * The picker's status line.
 *
 * Present only while there is something to say (saving, saved, failed), so an
 * idle panel does not carry a permanent line of reassurance. `saved` fades on
 * the Host's confirmation rather than on the click, because the click alone
 * does not mean the profile was written.
 */
const PICKER_STATUS: CSSProperties = { opacity: 0.7, fontSize: 12 }

/** The periods the bar renders, in display order. */
const PERIODS = ['today', 'month', 'total'] as const

/**
 * The copy each write outcome shows.
 *
 * An explicit table rather than a `fortune.${status}` template: the status
 * values and the dictionary keys are not the same names (`error` reports
 * `fortune.failed`), and a template would silently resolve to a missing key
 * instead of failing to compile.
 */
const FORTUNE_STATUS_KEY: Record<Exclude<FortuneWriteStatus, 'idle'>, IAmRichKey> = {
  saving: 'fortune.saving',
  saved: 'fortune.saved',
  error: 'fortune.failed',
}

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

/**
 * Narrow one polled ledger body into the view the bar renders.
 *
 * `fortune` is carried through only when it is a string; a Host that does not
 * report one leaves it undefined, which the picker renders as "no selection"
 * rather than as a guess.
 */
export function asLedger(value: unknown): WasteLedgerView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { days, fortune } = value as Partial<WasteLedgerView>
  if (typeof days !== 'object' || days === null) return undefined
  return typeof fortune === 'string' ? { days, fortune } : { days }
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
export function WasteStatusBarView({ wide, t, ledger, status, expanded, fortuneTier, fortuneStatus, onFortune, onEnter, onLeave }: WasteStatusBarViewProps) {
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

  // The picker shows only in the wide expanded panel. In the 56px rail there is
  // no room for a labelled radio group at all; showing it only on hover keeps
  // the resting row a readout.
  const showPicker = expanded && wide

  return (
    <span
      style={style}
      data-i-am-rich-waste={hasWaste ? 'total' : 'empty'}
      data-i-am-rich-scale={scale}
      data-i-am-rich-wide={wide ? 'true' : 'false'}
      data-i-am-rich-expanded={expanded ? 'true' : 'false'}
      data-i-am-rich-status={status}
      data-i-am-rich-fortune={fortuneTier ?? ''}
      data-i-am-rich-fortune-status={fortuneStatus}
      role="status"
      aria-label={translate('waste.aria')}
      title={tooltip}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {showPicker && (
        // `onClick` stops here so choosing a tier neither collapses the panel
        // nor reaches the shell's own foot handlers behind it.
        <span
          style={PICKER}
          data-i-am-rich-picker
          role="radiogroup"
          aria-label={translate('fortune.legend')}
          onClick={event => { event.stopPropagation() }}
        >
          <span style={PICKER_LEGEND}>{translate('fortune.legend')}</span>
          <span style={PICKER_OPTIONS}>
            {FORTUNE_TIERS.map(tier => (
              <label
                key={tier}
                style={PICKER_OPTION}
                data-i-am-rich-tier={tier}
                data-selected={fortuneTier === tier ? 'true' : 'false'}
                title={translate(`fortune.hint.${tier}` as IAmRichKey)}
              >
                <input
                  type="radio"
                  name="i-am-rich-fortune"
                  value={tier}
                  checked={fortuneTier === tier}
                  disabled={fortuneStatus === 'saving'}
                  onChange={() => { onFortune(tier) }}
                  style={{ margin: 0 }}
                />
                <span>{translate(`fortune.${tier}` as IAmRichKey)}</span>
              </label>
            ))}
          </span>
          {/* The status line reports the write, not the wish: it is fed by the
              Host's confirmation, so a failed save leaves the radio on the tier
              that is actually in effect. */}
          {fortuneStatus !== 'idle' && (
            <span style={PICKER_STATUS} data-i-am-rich-fortune-message={fortuneStatus}>
              {translate(FORTUNE_STATUS_KEY[fortuneStatus])}
            </span>
          )}
        </span>
      )}
      {shown.map(period => (
        // Each row carries its own coin. Repeating the glyph per period is what
        // makes a stacked panel read as three separate figures rather than one
        // wrapped sentence.
        <span key={period} style={FIGURE} data-i-am-rich-period={period} data-calls={calls[period]}>
          <span style={COIN_STYLE} data-i-am-rich-coin aria-hidden="true">{COIN}</span>
          {showLabel && <span style={LABEL}>{translate(`period.${period}` as IAmRichKey)}</span>}
          <span style={VALUE}>{figures[period].value}</span>
          <span style={UNIT}>{translate(unitKey(figures[period].unit))}</span>
          <span style={TOKEN_UNIT}>{translate('waste.unit')}</span>
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
  const [fortuneStatus, setFortuneStatus] = useState<FortuneWriteStatus>('idle')
  // The confirmed tier lives in state, not a ref: a ref mutated during the
  // poll's steady state (`status` already 'ok') would not re-render — React
  // bails out on an unchanged `Object.is` — and the radio could show a stale
  // tier for up to one poll interval.
  const [fortuneTier, setFortuneTier] = useState<FortuneTier | undefined>(undefined)
  const alive = useRef(true)
  // Monotonic write generation. A poll that started before the current write
  // began carries the tier as it was *then*; adopting its answer would revert
  // the radio behind the write's back. Each poll captures the generation at
  // its start and only adopts the Host's tier while it is still current — and
  // `chooseFortune` reads it the same way, so a *write* that was overtaken by a
  // later one cannot move the radio either.
  const writeSeq = useRef(0)

  useEffect(() => {
    alive.current = true

    const controller = new AbortController()

    const poll = async (): Promise<void> => {
      const seqAtStart = writeSeq.current
      try {
        const response = await fetch(WASTE_LEDGER_PATH, { signal: controller.signal })
        if (!response.ok) throw new Error(`ledger route answered ${String(response.status)}`)
        const body: unknown = await response.json()
        if (!alive.current) return
        const next = asLedger(body)
        setLedger(next)
        // A poll that started before the current write began carries the tier
        // as it was *then*; adopting its answer would revert the radio behind
        // the write's back, so the generation is re-tested on arrival.
        if (writeSeq.current === seqAtStart && isFortuneTier(next?.fortune)) setFortuneTier(next.fortune)
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

  /**
   * Persist one tier and reflect the Host's answer.
   *
   * The radio does not move on the click: `fortuneTier` is advanced only after
   * the Host accepts the write, so a rejected save leaves the picker showing
   * the tier the burn is actually using rather than the one that was asked
   * for. A failed write is reported, never silently kept. The generation is
   * bumped at write *start*, so a poll already in flight cannot overwrite the
   * answer with the pre-write tier.
   *
   * A write that a later one overtook is discarded on arrival for the same
   * reason: `disabled` on the radios keeps a second click out of a normal
   * pointer path, but it only applies once the `'saving'` render has committed,
   * so two writes can still overlap. Without the generation test the slower —
   * and older — response would win the radio, which is how the picker ends up
   * naming a tier the burn is no longer using.
   */
  const chooseFortune = async (tier: FortuneTier): Promise<void> => {
    writeSeq.current += 1
    setFortuneStatus('saving')
    try {
      const response = await fetch(FORTUNE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fortune: tier }),
      })
      if (!response.ok) throw new Error(`fortune route answered ${String(response.status)}`)
      if (!alive.current) return
      setFortuneTier(tier)
      setFortuneStatus('saved')
    } catch {
      if (!alive.current) return
      setFortuneStatus('error')
    }
  }

  return (
    <WasteStatusBarView
      {...props}
      ledger={ledger}
      status={status}
      expanded={expanded}
      fortuneTier={fortuneTier}
      fortuneStatus={fortuneStatus}
      onFortune={tier => { void chooseFortune(tier) }}
      onEnter={() => setExpanded(true)}
      onLeave={() => setExpanded(false)}
    />
  )
}

/**
 * Whether a wire value names a known tier.
 * @param value - the tier reported by the Host, if any.
 * @returns whether the value is one this client can render.
 */
function isFortuneTier(value: unknown): value is FortuneTier {
  return typeof value === 'string' && (FORTUNE_TIERS as readonly string[]).includes(value)
}
