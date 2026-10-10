/**
 * The standalone ledger files: monthly append-only JSONL under the DSH home,
 * folded back into per-day totals on read.
 *
 * These cases run against a real temporary directory, because the facts under
 * test are file-system facts: one line per discard, cross-month fan-out, and
 * tolerance of a crash-truncated tail.
 */

import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendLedgerEntry, closeLedgerHandles, ledgerMonthPath, ledgerRoot, readLedgerDays } from '../src/ledger-file.ts'
import { LEDGER_LINE_VERSION, type LlmWasteEventData } from '../src/types.ts'
import { WasteId } from '../src/brand.ts'

/** Roots created for one test, removed afterwards. */
const cleanup: string[] = []

afterEach(async () => {
  await closeLedgerHandles()
  await Promise.all(cleanup.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A discard with the minimum shape the writer accepts. */
function waste(day: string, overrides: Partial<LlmWasteEventData> = {}): LlmWasteEventData {
  return {
    wasteId: WasteId(`w-${day}-${cleanup.length}`),
    provider: 'deepseek',
    model: 'deepseek-chat',
    outcome: 'discarded',
    day,
    ...overrides,
  }
}

/** Create one throwaway ledger root. */
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'i-am-rich-'))
  cleanup.push(root)
  return root
}

describe('ledgerRoot', () => {
  it('prefers an explicit override', () => {
    expect(ledgerRoot('/tmp/ledger')).toBe('/tmp/ledger')
  })

  it('honors DSH_HOME over the default home', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = '/tmp/dsh-home'
    try {
      expect(ledgerRoot()).toBe(join('/tmp/dsh-home', 'i-am-rich'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('appendLedgerEntry / readLedgerDays', () => {
  it('round-trips a discard through its month file', async () => {
    const root = await tempRoot()

    await appendLedgerEntry(root, waste('2026-01-05', {
      usage: { inputTokens: 100, outputTokens: 20 },
    }))
    const days = await readLedgerDays(root)

    expect(days['2026-01-05']).toMatchObject({ pricedCalls: 1, inputTokens: 100, outputTokens: 20 })
  })

  it('writes one JSON line ending in a newline', async () => {
    const root = await tempRoot()

    await appendLedgerEntry(root, waste('2026-01-05', {
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
    const text = await readFile(ledgerMonthPath(root, '2026-01'), 'utf8')

    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toMatchObject({ v: LEDGER_LINE_VERSION, day: '2026-01-05', provider: 'deepseek' })
  })

  it('folds several discards of one day into one bucket', async () => {
    const root = await tempRoot()

    await appendLedgerEntry(root, waste('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1 } }))
    await appendLedgerEntry(root, waste('2026-01-05', { usage: { inputTokens: 5, outputTokens: 1 } }))
    const days = await readLedgerDays(root)

    expect(days['2026-01-05']).toMatchObject({ pricedCalls: 2, inputTokens: 15 })
  })

  it('routes days to their own monthly files', async () => {
    const root = await tempRoot()

    await appendLedgerEntry(root, waste('2026-01-31', { usage: { inputTokens: 10, outputTokens: 0 } }))
    await appendLedgerEntry(root, waste('2026-02-01', { usage: { inputTokens: 20, outputTokens: 0 } }))
    const names = (await readdir(root)).sort()
    const days = await readLedgerDays(root)

    expect(names).toEqual(['waste-2026-01.jsonl', 'waste-2026-02.jsonl'])
    expect(Object.keys(days).sort()).toEqual(['2026-01-31', '2026-02-01'])
  })

  it('counts an unpriced discard without claiming tokens', async () => {
    const root = await tempRoot()

    await appendLedgerEntry(root, waste('2026-01-05'))
    const days = await readLedgerDays(root)

    expect(days['2026-01-05']).toMatchObject({ unpricedCalls: 1, inputTokens: 0 })
  })

  it('skips a crash-truncated trailing line', async () => {
    const root = await tempRoot()
    await appendLedgerEntry(root, waste('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1 } }))
    const path = ledgerMonthPath(root, '2026-01')
    await writeFile(path, (await readFile(path, 'utf8'))
      + '{"v":1,"wasteId":"w-x","provider":"deepseek","model":"m","outcome":"discarde')

    const days = await readLedgerDays(root)

    expect(days['2026-01-05']).toMatchObject({ pricedCalls: 1, inputTokens: 10 })
  })

  it('skips a corrupt middle line and keeps the rest of the month', async () => {
    const root = await tempRoot()
    await appendLedgerEntry(root, waste('2026-01-05', { usage: { inputTokens: 10, outputTokens: 1 } }))
    await appendLedgerEntry(root, waste('2026-01-06', { usage: { inputTokens: 20, outputTokens: 1 } }))
    const path = ledgerMonthPath(root, '2026-01')
    const lines = (await readFile(path, 'utf8')).split('\n')
    await writeFile(path, [lines[0], 'not json at all', lines[1], lines[2]].join('\n'))

    const days = await readLedgerDays(root)

    expect(days['2026-01-05']).toMatchObject({ pricedCalls: 1, inputTokens: 10 })
    expect(days['2026-01-06']).toMatchObject({ pricedCalls: 1, inputTokens: 20 })
  })

  it('treats an absent ledger root as an empty ledger', async () => {
    const days = await readLedgerDays(await tempRoot())

    expect(days).toEqual({})
  })
})
