// Ground-truth check: replay the harness's own refusal decision.
//
// Usage: node scripts/verify-session-log.mjs <session.v4.jsonl.zstd> [...]
//
// A stored log is refused by the persistence read path when it holds an event
// whose type is outside the harness vocabulary and which lacks the envelope's
// `ignorable` marker (see dsh-session-persistence validateStoredEvents). This
// script answers exactly that question, so it can be run after a repair or
// after a plugin change without starting the app.
import { existsSync, readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { pathToFileURL } from "node:url";

/**
 * Load the installed harness's known-event vocabulary.
 *
 * The desktop app keeps its runtime inside the app bundle, so the bundle is
 * probed first; a workspace install is the fallback.
 */
async function loadKnownEventTypes() {
  const candidates = [
    "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js",
    new URL("../node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js", import.meta.url).pathname,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return (await import(pathToFileURL(candidate).href)).KNOWN_SESSION_EVENT_TYPES;
  }
  throw new Error("cannot locate @deepseek-ai/dsh-session known-event-types.js");
}

const KNOWN_SESSION_EVENT_TYPES = await loadKnownEventTypes();

const M = 4247762216;
function scan(b) {
  const F = []; let o = 0;
  while (o < b.length) {
    const s = o;
    if (b.length - o < 4) return { F, tornStart: s };
    if (b.readUInt32LE(o) !== M) throw new Error("invalid frame magic at byte " + o);
    o += 4;
    if (o === b.length) return { F, tornStart: s };
    const d = b.readUInt8(o); o += 1;
    if ((d & 24) !== 0) throw new Error("reserved frame-header bit at byte " + (o - 1));
    const csf = d >>> 6, ss = (d & 32) !== 0, ck = (d & 4) !== 0, df = d & 3;
    const db = df === 3 ? 4 : df;
    const csb = csf === 0 ? (ss ? 1 : 0) : 1 << csf;
    const rem = (ss ? 0 : 1) + db + csb;
    if (b.length - o < rem) return { F, tornStart: s };
    o += rem;
    for (;;) {
      if (b.length - o < 3) return { F, tornStart: s };
      const bh = b.readUIntLE(o, 3); o += 3;
      const last = (bh & 1) !== 0, bt = (bh >>> 1) & 3, bs = bh >>> 3;
      if (bt === 3) throw new Error("reserved block type at byte " + (o - 3));
      const pb = bt === 1 ? 1 : bs;
      if (b.length - o < pb) return { F, tornStart: s };
      o += pb;
      if (last) break;
    }
    if (ck) { if (b.length - o < 4) return { F, tornStart: s }; o += 4; }
    F.push({ start: s, end: o });
  }
  return { F };
}

export function verify(path, label) {
  const b = readFileSync(path);
  const { F, tornStart } = scan(b);
  const all = [];
  for (const f of F) all.push(...zstdDecompressSync(b.subarray(f.start, f.end)).toString("utf8").split("\n").filter(Boolean));
  const rows = all.map((l) => JSON.parse(l));

  // The header row (type "session") is read separately as metadata.
  const header = rows.find((r) => r.type === "session");
  const events = rows.filter((r) => r.type !== "session");

  // validateStoredEvents: unknown AND not ignorable => refuse the whole log.
  const refusing = events.filter((e) => !KNOWN_SESSION_EVENT_TYPES.has(e.type) && e.ignorable !== true);
  // surfaceOpOf: an unknown ignorable event must not carry surface metadata.
  const badSurface = events.filter(
    (e) => !KNOWN_SESSION_EVENT_TYPES.has(e.type) && e.ignorable === true
      && (e.surfaceOp !== undefined || e.sourceEventSeqs !== undefined),
  );

  console.log(`\n=== ${label} ===`);
  console.log(`  zstd frames: ${F.length}   torn final frame: ${tornStart === undefined ? "none" : "YES"}`);
  console.log(`  header: version=${header?.version} id=${header?.id}`);
  console.log(`  events: ${events.length}`);
  const ok = refusing.length === 0 && badSurface.length === 0 && tornStart === undefined;
  console.log(`  events that would REFUSE the log: ${refusing.length}`);
  if (refusing.length) {
    const t = {}; for (const e of refusing) t[e.type] = (t[e.type] ?? 0) + 1;
    console.log(`    ${JSON.stringify(t)}  (first at seq ${refusing[0].seq})`);
  }
  console.log(`  ignorable events carrying surface metadata: ${badSurface.length}`);
  console.log(ok ? "  RESULT: OPENS" : "  RESULT: REFUSED");
  return ok;
}

// CLI entry: verify each path given on the command line.
const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: node scripts/verify-session-log.mjs <session.v4.jsonl.zstd> [...]");
  process.exit(2);
}
let allOpen = true;
for (const target of targets) {
  allOpen = verify(target, target) && allOpen;
}
console.log(allOpen ? "\nALL SESSIONS OPEN" : "\nSOME SESSIONS STILL REFUSED");
process.exit(allOpen ? 0 : 1);
