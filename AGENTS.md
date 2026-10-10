# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## What this is

`@studyzy/dsh-i-am-rich` — a DSH (DeepSeek Harness) novelty plugin. It duplicates every model request, throws the duplicate away, and honestly reports the wasted tokens in a Web status bar. The duplicate is a real, billed provider call; the accounting uses only provider-reported `usage` (no estimation, no invention). "行为是段子，账本是账本。"

The DSH agent source lives at `../../deepseek-harness/` — consult it when questions touch harness internals (cordis, llm waterfall, session logs, slots, projections).

## Commands

```sh
pnpm install            # pnpm@11.7.0 pinned via packageManager; pnpm-lock.yaml is the only lockfile
pnpm run check          # full gate: lint + typecheck + typecheck:tests + test + build (CI runs this on Node 22.19 & 24.x)
pnpm run lint           # oxlint src tests tsdown.config.ts
pnpm run typecheck      # tsc --noEmit on src
pnpm run typecheck:tests
pnpm test               # vitest run tests
pnpm run build          # tsc (declarations to lib/types) then tsdown → lib/index.js (ESM/Node) + lib/client.js (CJS/browser)
```

Run a single spec file: `pnpm vitest run tests/waste.spec.ts`
Run a single test by name: `pnpm vitest run tests/i-am-rich.spec.ts -t "invokes the underlying adapter twice"`

Requires Node `^22.19.0 || >=24.0.0`.

## Architecture: a dual-face plugin

One package, two artifacts loaded by different worlds:

**Host half (Node)** — `src/index.ts` → `lib/index.js` (ESM), loaded by the cordis Loader.
- Hooks the `llm/stream` waterfall. For each request it calls `next()` twice: once for the real request (returned to the agent loop), once per `discardedCopies` (drained and dropped by `burn()`).
- Each discard is recorded as a durable `plugin:i-am-rich/waste` record on the owning session, stamped with the local day at append time.
- Request attribution resolves **synchronously at request time**: `ctx.agents.currentInitiator()` first, then the sole agent if `agents.list().length === 1`; otherwise burn happens but no record is written. Do not move resolution after the duplicate drains — a sibling agent appearing mid-flight must not make real spend unattributable.
- Registers the `wasteLedger` session projection (`src/projection.ts`), a clock-free fold of discard records into per-day buckets. Its `view()` publishes only the per-day ledger; **period selection (today/month/total) happens in the client**, which owns the clock. This is what makes replay reproduce live figures exactly.
- `src/records.ts` is the only write path. It probes for the harness's `appendPluginRecord` (runtime feature detection, not version compare) and degrades to "burn but don't record" on harnesses older than `0.2.1-alpha.2`. **Never write an unknown event type via plain `Session.append`** — without the `ignorable` marker the harness refuses the entire session log.
- `src/waste.ts` holds all pure arithmetic (folds, `sumPeriods`, 万/亿 vs K/M/B magnitude scaling). Pure logic belongs here so tests need no Host or cordis context.

**Client half (browser)** — `src/client/` → `lib/client.js` (CJS), loaded by the browser module system via the `dsh.client` declaration in `package.json`.
- `src/client/index.ts` registers into the `sidebar.footer.action` slot (declared by `ui-sidebar`) via `slots.inject`. **The slot name is load-bearing**: registering into an undeclared slot fails silently (the bar never mounts, indistinguishable from a load failure).
- `StatusBar.tsx` renders the bar; `locales.ts` has `zh` (source of truth) and `en` dictionaries; `contracts.ts` narrows the browser kernel type surface.

## Hard constraints (do not break)

- **`tests/i-am-rich.spec.ts` → `invokes the underlying adapter twice` is the most load-bearing test.** It counts actual adapter invocations — the only proof the second request really goes out. Do not weaken or delete it when touching duplicate-request logic.
- **Client externals**: `react`, `react/jsx-runtime`, `@deepseek-ai/cordis` must stay external in the client build (`CLIENT_EXTERNALS` in `tsdown.config.ts` / `deps.neverBundle`). The browser kernel supplies them; bundling them breaks module resolution.
- **Client build must be CJS wrapped in `window.__ModuleLoader__.load({ id, factory })`** — the browser kernel materializes factories, it does not execute ESM. Configured via banner/footer in `tsdown.config.ts`.
- **Client components use inline styles, not CSS files** — `tsc` won't copy `.css` into the output. Prefer existing `--dsw-*` theme variables.
- **Plugin id must stay `i-am-rich`** (both `cordis.patch.yml` and `src/index.ts`'s `name`). Renaming it silently breaks existing profile configs (e.g. the `enabled` toggle).
- Behavior changes require tests. Before a PR, `pnpm run check` must pass.

## Conventions

- `README.md` (Chinese) is the single source of truth; `README.en.md` must keep the same section structure — update the corresponding section in both.
- Comments explain **why**, not what; every exported symbol has a doc comment with `@param`/`@returns` where applicable.
- The record type history matters: current name is `plugin:i-am-rich/waste`; legacy `llm/waste` is folded read-only by the projection for old logs, never written.
