/**
 * The `wasteToday` projection: discarded usage folds into per-day buckets and
 * publishes the latest day's total, with the day stamped by the Host so replay
 * reproduces live totals without a clock.
 */

import { describe, expect, it } from 'vitest'
import { createWasteTodayProjection } from '../src/projection.ts'
import type { LlmWasteEventData, WasteId } from '../src/types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Build one `llm/waste` session event for the fold. */
function wasteEvent(day: string, overrides: Partial<LlmWasteEventData> = {}): SessionEvent {
  return {
    type: 'llm/waste',
    data: {
      wasteId: 'w1' as WasteId,
      provider: 'deepseek',
      model: 'deepseek-chat',
      outcome: 'discarded',
      day,
      ...overrides,
    },
  } as unknown as SessionEvent
}

/** An unrelated event the projection must ignore by reference. */
const UNRELATED = { type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent

const projection = createWasteTodayProjection()
const header = undefined as never
const inherited = 0 as never

/** Fold a series of events through a fresh projection state. */
function fold(events: readonly SessionEvent[]) {
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(header, inherited),
  )
}

describe('wasteToday projection', () => {
  it('starts empty', () => {
    expect(projection.init(header, inherited)).toEqual({ days: {} })
  })

  it('ignores events that are not discards by returning the same reference', () => {
    const state = projection.init(header, inherited)

    expect(projection.apply(state, UNRELATED)).toBe(state)
  })

  it('folds one discard into its stamped day', () => {
    const state = fold([wasteEvent('2026-01-05', {
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    })])

    expect(state.days['2026-01-05']).toMatchObject({
      pricedCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
    })
  })

  it('keeps separate days in separate buckets', () => {
    const state = fold([
      wasteEvent('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } }),
      wasteEvent('2026-01-06', { usage: { inputTokens: 200, outputTokens: 2, totalTokens: 202 } }),
    ])

    expect(state.days['2026-01-05']?.inputTokens).toBe(10)
    expect(state.days['2026-01-06']?.inputTokens).toBe(200)
  })

  it('reports the latest day and its token total', () => {
    const state = fold([
      wasteEvent('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } }),
      wasteEvent('2026-01-06', { usage: { inputTokens: 200, outputTokens: 2, totalTokens: 202 } }),
    ])

    expect(projection.wire.view(state)).toEqual({
      days: state.days,
      latestDay: '2026-01-06',
      latestTotal: 202,
    })
  })

  it('counts an unpriced discard without claiming tokens', () => {
    const state = fold([wasteEvent('2026-01-05')])
    const view = projection.wire.view(state)

    expect(state.days['2026-01-05']?.unpricedCalls).toBe(1)
    expect(view.latestTotal).toBe(0)
  })

  it('reports an empty view before any discard', () => {
    expect(projection.wire.view(projection.init(header, inherited))).toEqual({
      days: {},
      latestDay: undefined,
      latestTotal: 0,
    })
  })

  it('does not mutate the state it folds into', () => {
    const before = fold([wasteEvent('2026-01-05', {
      usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
    })])
    const snapshot = structuredClone(before)

    projection.apply(before, wasteEvent('2026-01-05', {
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
    }))

    expect(before).toEqual(snapshot)
  })
})