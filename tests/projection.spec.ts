/**
 * The `wasteLedger` projection: discarded usage folds into per-day buckets and
 * publishes the whole ledger, with the day stamped by the Host so replay
 * reproduces live totals without a clock.
 *
 * Period selection (today, this month, all time) is deliberately absent here —
 * it belongs to the client that owns the clock. These cases assert the fold and
 * the published days only.
 */

import { describe, expect, it } from 'vitest'
import { createWasteLedgerProjection } from '../src/projection.ts'
import { LEGACY_WASTE_RECORD_TYPE, WASTE_RECORD_TYPE, type LlmWasteEventData, type WasteId } from '../src/types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Build one discard record for the fold.
 * @param day - local calendar day to stamp.
 * @param overrides - fields to override on the record.
 * @param type - record name; defaults to the current `plugin:` name.
 */
function wasteEvent(
  day: string,
  overrides: Partial<LlmWasteEventData> = {},
  type: string = WASTE_RECORD_TYPE,
): SessionEvent {
  return {
    type,
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

const projection = createWasteLedgerProjection()
const header = undefined as never
const inherited = 0 as never

/** Fold a series of events through a fresh projection state. */
function fold(events: readonly SessionEvent[]) {
  return events.reduce(
    (state, event) => projection.apply(state, event),
    projection.init(header, inherited),
  )
}

describe('wasteLedger projection', () => {
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

  it('keeps days in different months separate', () => {
    const state = fold([
      wasteEvent('2026-01-31', { usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 } }),
      wasteEvent('2026-02-01', { usage: { inputTokens: 20, outputTokens: 0, totalTokens: 20 } }),
    ])

    expect(Object.keys(state.days).sort()).toEqual(['2026-01-31', '2026-02-01'])
  })

  it('publishes the whole ledger without pre-computed periods', () => {
    const state = fold([wasteEvent('2026-01-05', {
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    })])

    // Periods are the client's job; the wire view carries days and nothing else.
    expect(projection.wire.view(state)).toEqual({ days: state.days })
  })

  it('counts an unpriced discard without claiming tokens', () => {
    const state = fold([wasteEvent('2026-01-05')])

    expect(state.days['2026-01-05']?.unpricedCalls).toBe(1)
    expect(state.days['2026-01-05']?.inputTokens).toBe(0)
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

  it('folds records written under the legacy name', () => {
    // Sessions written before the plugin adopted the `plugin:` namespace hold
    // `llm/waste` records. They are never written again, but the spend they
    // recorded is real and must keep showing up after a reload.
    const state = fold([wasteEvent('2026-01-05', {
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    }, LEGACY_WASTE_RECORD_TYPE)])

    expect(state.days['2026-01-05']).toMatchObject({ pricedCalls: 1, inputTokens: 100 })
  })

  it('folds legacy and current records into the same day bucket', () => {
    const state = fold([
      wasteEvent('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 } }, LEGACY_WASTE_RECORD_TYPE),
      wasteEvent('2026-01-05', { usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } }),
    ])

    expect(state.days['2026-01-05']).toMatchObject({ pricedCalls: 2, inputTokens: 15 })
  })
})