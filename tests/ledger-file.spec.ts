/**
 * The standalone ledger files: monthly append-only JSONL under the DSH home,
 * folded back into per-day totals on read.
 *
 * These cases run against a real temporary directory, because the facts under
 * test are file-system facts: one line per discard, cross-month fan-out, and
 * tolerance of a crash-truncated tail.
 */

import { execSync } from 'node:child_process'
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

/**
 * Count this process's open descriptors for one file.
 *
 * The ledger's real failure mode is a descriptor that outlives its owner, which
 * is invisible to the file's own contents; counting descriptors is the only
 * assertion that sees it. `lsof` is used rather than `/dev/fd` because the
 * latter lists descriptors for the *calling* process only on Linux and is a
 * thin `lsof` on macOS.
 * @param path - the file whose descriptors to count.
 * @returns how many descriptors this process currently holds for `path`.
 */
function openDescriptors(path: string): number {
  try {
    const output = execSync(`lsof -p ${String(process.pid)} 2>/dev/null | grep -c -- ${JSON.stringify(path)}`)
    return Number(output.toString().trim())
  } catch {
    // `grep -c` exits non-zero when it matches nothing, which is zero here.
    return 0
  }
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

describe('ledger handle lifecycle', () => {
  /**
   * Concurrent appends must share one handle.
   *
   * Discards are recorded fire-and-forget, so several `appendLedgerEntry` calls
   * land in the same tick. Before `pendingOpens` deduplicated the open, both
   * callers passed the empty-cache check, both opened the file, and the handle
   * that lost the cache slot was orphaned while still open. Node closes such a
   * leaked `FileHandle` from a GC finalizer and raises `ERR_INVALID_STATE` as a
   * hard error, killing the whole host process — the user-visible symptom was
   * dsh crashing rather than a ledger warning.
   *
   * The assertion counts open descriptors for the month's file, because that is
   * the leak itself: the bug left 11 of 12 descriptors open after disposal, and
   * each orphan is eventually closed by a GC finalizer that Node treats as a
   * fatal `ERR_INVALID_STATE`. A line-count assertion cannot see this — the
   * writes still all landed — which is exactly why the leak shipped.
   */
  it('opens one descriptor per file across a concurrent burst, and closes it on disposal', async () => {
    const root = await tempRoot()
    const monthPath = ledgerMonthPath(root, '2026-01')
    const burst = Array.from({ length: 12 }, (_value, index) =>
      appendLedgerEntry(root, waste('2026-01-05', { wasteId: WasteId(`w-burst-${String(index)}`) })))

    await expect(Promise.all(burst)).resolves.toHaveLength(12)
    // Twelve concurrent appends must share a single descriptor, not open twelve.
    expect(openDescriptors(monthPath)).toBe(1)

    await closeLedgerHandles()
    // Nothing may survive disposal: an orphan here is the fatal GC leak.
    expect(openDescriptors(monthPath)).toBe(0)

    const text = await readFile(monthPath, 'utf8')
    const lines = text.split('\n').filter(line => line !== '')
    // Every concurrent append landed as its own complete line: a lost handle
    // would have dropped writes as well as leaked a descriptor.
    expect(lines).toHaveLength(12)
    expect(new Set(lines.map(line => (JSON.parse(line) as LlmWasteEventData).wasteId)).size).toBe(12)
  })

  it('accepts appends again after disposal', async () => {
    const root = await tempRoot()
    await appendLedgerEntry(root, waste('2026-01-05'))
    await closeLedgerHandles()

    // A reload mounts the plugin again against the same month's file.
    await expect(appendLedgerEntry(root, waste('2026-01-05'))).resolves.toBeUndefined()

    const days = await readLedgerDays(root)
    // The minimum-shape discard carries no `usage`, so it folds as unpriced;
    // what this case pins is that the post-disposal append was recorded at all.
    expect(days['2026-01-05']).toMatchObject({ unpricedCalls: 2 })
  })
})
