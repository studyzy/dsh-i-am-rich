/**
 * The standalone ledger file system: the only place discarded usage is
 * written or read.
 *
 * The ledger lives outside the harness session log, in monthly append-only
 * JSONL files under the DSH home. One line per discarded duplicate request:
 * the file is a dumb, inspectable fact store, and every figure the status bar
 * shows is folded from it on demand.
 *
 * Crash safety is the file system's, not ours: an append-only single-line
 * `write` on a local file system is atomic in practice, so a crash can leave
 * at most a trailing partial line. The read side skips any line that fails to
 * parse rather than refusing the whole month.
 */

import { open, mkdir, readdir, readFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z as zod } from 'zod'
import { WasteId } from './brand.ts'
import { addWaste, EMPTY_TOTALS, type WasteTotals } from './waste.ts'
import { LEDGER_LINE_VERSION, type LlmWasteEventData } from './types.ts'

/**
 * Schema for one ledger line as persisted.
 *
 * Typed unbranded: the line's `wasteId` is an ordinary string on disk, and the
 * brand is re-applied after validation rather than promised by the parser.
 */
const ledgerLineSchema = zod.object({
  v: zod.literal(LEDGER_LINE_VERSION),
  wasteId: zod.string(),
  provider: zod.string(),
  model: zod.string(),
  outcome: zod.union([zod.literal('discarded'), zod.literal('failed')]),
  day: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  usage: zod.object({
    inputTokens: zod.number(),
    outputTokens: zod.number(),
    cacheReadTokens: zod.number().optional(),
    cacheWriteTokens: zod.number().optional(),
  }).optional(),
})

/**
 * The ledger root directory.
 * @param override - explicit root, winning over the environment; tests use it.
 * @returns `<DSH_HOME|~/.dsh>/i-am-rich`.
 */
export function ledgerRoot(override?: string): string {
  if (override !== undefined) return override
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'i-am-rich')
}

/**
 * The monthly file holding a month's discards.
 * @param root - ledger root directory.
 * @param month - local calendar month as `YYYY-MM`.
 * @returns the month's append-only JSONL file path.
 */
export function ledgerMonthPath(root: string, month: string): string {
  return join(root, `waste-${month}.jsonl`)
}

/** One open monthly file, kept so repeated discards skip reopen costs. */
const handles = new Map<string, FileHandle>()

/**
 * Append one discard to its month's file.
 *
 * Fire-and-forget from the caller's perspective: a failure here is reported
 * through the rejected promise and must never reach the original request. The
 * line ends with `\n`; a crash mid-write can therefore leave only a trailing
 * partial line, which the read side skips.
 * @param root - ledger root directory.
 * @param data - the discard to record.
 */
export async function appendLedgerEntry(root: string, data: LlmWasteEventData): Promise<void> {
  const month = data.day.slice(0, 7)
  const path = ledgerMonthPath(root, month)
  let handle = handles.get(path)
  if (handle === undefined) {
    await mkdir(root, { recursive: true })
    handle = await open(path, 'a')
    handles.set(path, handle)
  }
  const line = JSON.stringify({ v: LEDGER_LINE_VERSION, ...data }) + '\n'
  await handle.writeFile(line)
}

/**
 * Close every cached monthly file handle.
 *
 * Called on plugin disposal: without it, handles outlive the plugin and a
 * later reload would write through a stale descriptor.
 */
export async function closeLedgerHandles(): Promise<void> {
  const open = [...handles.values()]
  handles.clear()
  await Promise.all(open.map(handle => handle.close()))
}

/**
 * Fold every monthly file into per-day totals.
 *
 * Lines that fail validation — a crash-truncated tail, or a middle line a
 * foreign hand edited — are skipped, because one bad line must not hide the
 * spend recorded by every good one.
 * @param root - ledger root directory.
 * @returns day-keyed totals across every month on disk.
 */
export async function readLedgerDays(root: string): Promise<Record<string, WasteTotals>> {
  const days: Record<string, WasteTotals> = {}
  let names: string[]
  try {
    names = (await readdir(root)).filter(name => /^waste-\d{4}-\d{2}\.jsonl$/u.test(name)).sort()
  } catch (error) {
    // Only an absent root means no discards have ever been recorded; any other
    // failure is a real fault the reader (and the route) must surface.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return days
    throw error
  }
  for (const name of names) {
    const text = await readFile(join(root, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let data: LlmWasteEventData
      try {
        const parsed = ledgerLineSchema.parse(JSON.parse(line))
        data = { ...parsed, wasteId: WasteId(parsed.wasteId) }
      } catch {
        // Skip an unparseable line; the rest of the month stays honest.
        continue
      }
      const current = days[data.day]
      days[data.day] = addWaste(current ?? EMPTY_TOTALS, data)
    }
  }
  return days
}
