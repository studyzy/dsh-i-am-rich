# dsh-i-am-rich

> Sends every model request twice, throws the second copy away, and honestly reports how many tokens you wasted today.

A DeepSeek Harness plugin whose only purpose is to **genuinely spend twice as much money** and then **honestly** show you the waste.

## What it does

```
one model request
    ├─ copy 1 ──> returned to the agent loop (the reply you actually use)
    └─ copy 2 ──> fully received, then discarded
                     │
                     └─> records the usage the provider reported for it
                              │
                              └─> status bar: "Wasted 1,200 tokens today"
```

Both copies are **real, billed provider requests**. Nothing is simulated or estimated: the second request goes over the network, the provider bills for it, and its content is dropped.

## Install

```sh
npm install @deepseek-ai/dsh-i-am-rich
```

Or merge `cordis.patch.yml` into your profile:

```yaml
- insert:
    - id: i-am-rich
      name: '@deepseek-ai/dsh-i-am-rich'
```

## Configuration

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether requests are duplicated. Turning it off leaves the plugin loaded and the status bar live, but stops spending. |
| `discardedCopies` | number | `1` | How many extra copies to discard per request. `1` sends twice and throws one away. |

```yaml
- id: i-am-rich
  name: '@deepseek-ai/dsh-i-am-rich'
  config:
    enabled: true
    discardedCopies: 1
```

## How the numbers are computed

Every figure in the status bar is **usage the provider itself reported**. Nothing is estimated, scaled, or invented:

- Only discards whose provider reported `usage` contribute tokens.
- A discard the provider did not price is counted separately as an unpriced call, and **claims no tokens**.
- A duplicate that failed mid-stream after reporting usage still contributes that usage, because the money was really spent.

Totals are bucketed by local calendar day. The day is stamped when the Host appends the record, so **replay produces exactly the figures seen live** and does not depend on a clock at read time.

## Known costs

Stated plainly:

1. **The bill really is double.** That is the entire point of the plugin, not a defect.
2. **It is in tension with the harness's `model-visible ⟺ logged` convention.** The duplicate produces real provider billing but has no corresponding `assistant/attempt` in the session log, because its result was dropped. This plugin records that fact durably as a **non-surface** `llm/waste` event instead of pretending it did not happen. Model-visible input therefore remains fully reconstructable; what the extra event records is **spending**, not model context.
3. **Higher latency and rate-limit pressure.** Duplicates are dispatched concurrently with the original request, consuming additional concurrency.

## Why the bar shows only one copy's worth

With `discardedCopies: 2` three requests are sent (one real, two discarded); the status bar counts only **the two discarded ones**. It reports waste, not throughput — tokens you actually used are not waste.

## Development

```sh
npm install
npm run check     # lint + typecheck + typecheck:tests + test + build
npm test
```

The load-bearing test is `invokes the underlying adapter twice` in `tests/i-am-rich.spec.ts`: it counts **how many times the adapter is invoked**. That is the only assertion that proves a second request was really sent — counting downstream listeners does not.

## Layout

```
src/index.ts        Host plugin: hooks llm/stream, sends duplicates, records llm/waste
src/waste.ts        Pure folds: discarded usage into per-day totals
src/projection.ts   wasteToday projection: publishes the daily ledger to the Web client
src/types.ts        The llm/waste event type (non-surface)
src/client/         Browser half: the status bar
```

## License

MIT