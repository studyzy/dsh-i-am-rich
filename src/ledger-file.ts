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
 * Opens in flight, keyed by path.
 *
 * Discards are appended fire-and-forget and several can arrive in the same
 * tick, so "is it cached yet?" is not enough to decide who opens the file:
 * without this map two callers race through the `mkdir`/`open` awaits, and the
 * handle that loses the cache slot is orphaned while still open.
 */
const pendingOpens = new Map<string, Promise<FileHandle>>()

/**
 * Whether {@link closeLedgerHandles} is running.
 *
 * An open that completes after the cache was cleared would publish a handle no
 * disposer will ever reach, so the open path checks this flag and closes its
 * own handle rather than leaking one into the fatal GC path.
 */
let closing = false

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
  const line = `${
    JSON.stringify({ v: LEDGER_LINE_VERSION, ...data })
  }\n`
  await handleFor(root, path).then(handle => handle.writeFile(line))
}

/**
 * Resolve the shared append handle for one monthly file, opening it at most
 * once even under concurrent appends.
 *
 * The open is deduplicated through {@link pendingOpens} because discards are
 * recorded fire-and-forget and several land at once: without it, two callers
 * both observe an empty cache, both open the file, and the loser's handle is
 * dropped on the floor — overwritten in the cache by the winner and never
 * closed. A leaked open `FileHandle` is not a benign leak: Node closes it from
 * a GC finalizer and raises `ERR_INVALID_STATE` as a hard error, which takes
 * the entire host process down and reaches the user as a crashed dsh.
 * @param root - ledger root directory, created if absent.
 * @param path - the monthly file to append to.
 * @returns the cached handle, opening it if this is the first caller.
 */
async function handleFor(root: string, path: string): Promise<FileHandle> {
  const cached = handles.get(path)
  if (cached !== undefined) return cached
  const inFlight = pendingOpens.get(path)
  if (inFlight !== undefined) return inFlight
  const opening = (async (): Promise<FileHandle> => {
    await mkdir(root, { recursive: true })
    const handle = await open(path, 'a')
    // The cache is authoritative for closing: a handle handed back to callers
    // must be the one the disposer will reach, or it leaks into the fatal GC
    // path above. A concurrent `closeLedgerHandles` can clear the cache while
    // this open is still in flight, so re-check and close our own handle
    // instead of publishing one nothing owns.
    if (closing) {
      await handle.close()
      throw new Error('i-am-rich: ledger is closing; append rejected')
    }
    handles.set(path, handle)
    return handle
  })()
  pendingOpens.set(path, opening)
  try {
    return await opening
  } finally {
    pendingOpens.delete(path)
  }
}

/**
 * Close every cached monthly file handle.
 *
 * Called on plugin disposal: without it, handles outlive the plugin and a
 * later reload would write through a stale descriptor.
 *
 * A handle that is dropped while still open is fatal, not merely untidy: Node
 * closes leaked `FileHandle`s from a GC finalizer and treats that as an
 * `ERR_INVALID_STATE` hard error that takes the whole host process down
 * ("A FileHandle object was closed during garbage collection"), which is how a
 * leaked ledger descriptor surfaces to the user as a crashed dsh rather than as
 * a warning. Every handle is therefore closed explicitly here, and a close
 * failure is collected rather than allowed to abandon the remaining handles:
 * stopping at the first rejection would leak every later descriptor into
 * exactly that fatal path.
 * @returns a promise that settles once every cached handle has been closed.
 */
export async function closeLedgerHandles(): Promise<void> {
  closing = true
  // Drain the shared map *before* awaiting, so a concurrent append cannot
  // observe a half-closed cache and write through a descriptor being closed.
  const open = [...handles.values()]
  handles.clear()
  const results = await Promise.allSettled(open.map(handle => handle.close()))
  // Reopenable afterwards: a reload mounts the plugin again and must be able to
  // record into the same month's file.
  closing = false
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed.length > 0) {
    // One unreachable descriptor must not mask the fate of the others; there is
    // no recovery here beyond reporting, because the file system already owns
    // durability of what was written.
    throw new AggregateError(failed.map(result => result.reason), `i-am-rich: failed to close ${String(failed.length)} ledger handle(s)`)
  }
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
