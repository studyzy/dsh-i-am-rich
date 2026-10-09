/**
 * Repair DSH session logs that a harness refuses to interpret.
 *
 * A log is refused when it contains an event whose type is outside the
 * harness's known vocabulary and which lacks the envelope's `ignorable`
 * marker. See:
 *   dsh-session-persistence  validateStoredEvents()
 *   dsh-session/surface.js   surfaceOpOf()  (retains-and-skips ignorable)
 *
 * This adds `"ignorable":true` to exactly those events. The record type and
 * its data are never touched, so any projection that folds by type still works
 * (the i-am-rich waste ledger folds these records unchanged).
 *
 * The container is a concatenation of independent zstd frames, each holding
 * one or more JSONL records. Only frames containing an offender are
 * recompressed; every other frame is copied byte-for-byte. Offending records
 * are rewritten by targeted string surgery on the raw JSON text, so no other
 * byte of the log can change (a parse/re-stringify round trip would reorder or
 * reformat unrelated records).
 *
 * Usage:
 *   node repair_session_log.mjs <session.v4.jsonl.zstd> [--known <types.json>] [--dry-run]
 *
 *   --known   JSON array of event type names the target harness knows.
 *             Defaults to the vocabulary of the installed 0.2.0-rc.2 harness.
 *   --dry-run Report what would change without writing.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const ZSTD_MAGIC = 4247762216

/** Event vocabulary of the installed 0.2.0-rc.2 harness. */
const DEFAULT_KNOWN = [
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
  'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done', 'command/run',
  'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
  'deliverables/presented', 'developer/message', 'feedback/message-delete', 'feedback/message-put',
  'feedback/record', 'goal/change', 'hook/invoked', 'hook/result', 'image/offload', 'llm/retry',
  'llm/retry-started', 'model/selection', 'permission/preset', 'plan/mode', 'request/context',
  'request/header', 'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
  'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end', 'step/start',
  'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy', 'system/message',
  'team/member', 'team/message/delivered', 'team/message/queued', 'team/task', 'todo/write',
  'tool-workflow/agent-end', 'tool-workflow/agent-start', 'tool-workflow/run-end',
  'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start',
  'tool/result', 'turn/end', 'turn/start', 'user/message', 'web/deepseek-search-llm-request',
  'workspace/changes',
]

/** Locate complete zstd frames, mirroring the harness's scanZstdFrames. */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** Match the writer's own frame options so repaired frames stay in-family. */
const FRAME_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/**
 * Add the ignorable marker to one raw JSONL record line, leaving every other
 * byte untouched. Returns the original text when no change is needed.
 * @param line - one raw JSONL line, with or without its trailing newline.
 * @param known - event types the target harness recognizes.
 */
function markIgnorable(line, known) {
  if (line.trim() === '') return line
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return line
  }
  if (record === null || typeof record !== 'object') return line
  // The header row carries the session identity, not an event; it is read
  // separately and must never gain an event-envelope field.
  if (record.version !== undefined && record.id !== undefined && record.seq === undefined) return line
  const type = record.type
  if (typeof type !== 'string') return line
  if (known.has(type)) return line
  if (record.ignorable === true) return line
  // Insert before the final `}` so the rest of the line is byte-identical.
  const match = /^(.*\})(\s*)$/s.exec(line)
  if (match === null) throw new Error(`record "${type}" is not a JSON object`)
  return `${match[1].slice(0, -1)},"ignorable":true}${match[2]}`
}

function repair(path, known, { dryRun = false } = {}) {
  const original = readFileSync(path)
  const { frames, tornStart } = scanZstdFrames(original)
  if (tornStart !== undefined) {
    throw new Error(`refusing to repair a log with a torn final frame at byte ${tornStart}; let the writer finish`)
  }

  const pieces = []
  let repairedFrames = 0
  const repairedTypes = new Map()

  for (const frame of frames) {
    const raw = original.subarray(frame.start, frame.end)
    const text = zstdDecompressSync(raw).toString('utf8')
    const lines = text.split('\n')
    let touched = 0
    const outLines = lines.map((line) => {
      const next = markIgnorable(line, known)
      if (next === line) return line
      touched += 1
      try {
        const t = JSON.parse(next).type
        repairedTypes.set(t, (repairedTypes.get(t) ?? 0) + 1)
      } catch { /* counted anyway */ }
      return next
    })
    if (touched === 0) {
      pieces.push(raw) // untouched: copied byte-for-byte
      continue
    }
    pieces.push(zstdCompressSync(Buffer.from(outLines.join('\n'), 'utf8'), FRAME_OPTIONS))
    repairedFrames += 1
  }

  const out = Buffer.concat(pieces)
  const repairedRecords = [...repairedTypes.values()].reduce((a, b) => a + b, 0)

  // Verify: identical records, with only `ignorable` added where intended.
  const check = scanZstdFrames(out)
  if (check.tornStart !== undefined) throw new Error('repaired log has a torn final frame')
  const before = []
  const after = []
  for (const frame of frames) before.push(...zstdDecompressSync(original.subarray(frame.start, frame.end)).toString('utf8').split('\n').filter(Boolean))
  for (const frame of check.frames) after.push(...zstdDecompressSync(out.subarray(frame.start, frame.end)).toString('utf8').split('\n').filter(Boolean))
  if (before.length !== after.length) throw new Error(`record count changed: ${before.length} -> ${after.length}`)

  let verified = 0
  for (let i = 0; i < before.length; i += 1) {
    const a = JSON.parse(before[i])
    const b = JSON.parse(after[i])
    if (JSON.stringify(a) === JSON.stringify(b)) continue
    const { ignorable, ...rest } = b
    if (ignorable !== true) throw new Error(`record ${i} gained something other than ignorable`)
    if (known.has(a.type)) throw new Error(`record ${i} of known type "${a.type}" was modified`)
    if (JSON.stringify(rest) !== JSON.stringify(a)) throw new Error(`record ${i} ("${a.type}") changed beyond ignorable`)
    verified += 1
  }
  if (verified !== repairedRecords) {
    throw new Error(`verification mismatch: repaired ${repairedRecords}, verified ${verified}`)
  }

  // Final proof: no event row is unknown-and-unmarked any more.
  const remaining = after
    .map((l) => JSON.parse(l))
    .filter((r) => r.seq !== undefined && typeof r.type === 'string' && !known.has(r.type) && r.ignorable !== true)
  if (remaining.length > 0) throw new Error(`${remaining.length} unmarked unknown events remain`)

  if (!dryRun) {
    const tmp = `${path}.tmp`
    writeFileSync(tmp, out)
    renameSync(tmp, path)
  }

  return {
    frames: frames.length,
    repairedFrames,
    repairedRecords: verified,
    repairedByType: Object.fromEntries(repairedTypes),
    bytesBefore: original.length,
    bytesAfter: out.length,
  }
}

const argv = process.argv.slice(2)
const target = argv.find((a) => !a.startsWith('--'))
if (!target || !existsSync(target)) {
  console.error('usage: node repair_session_log.mjs <session.v4.jsonl.zstd> [--known <types.json>] [--dry-run]')
  process.exit(2)
}
const knownIdx = argv.indexOf('--known')
const known = new Set(
  knownIdx === -1 ? DEFAULT_KNOWN : JSON.parse(readFileSync(argv[knownIdx + 1], 'utf8')),
)
console.log(JSON.stringify({ target, ...repair(target, known, { dryRun: argv.includes('--dry-run') }) }, null, 2))