# dsh-i-am-rich

> Sends every model request twice, throws the second copy away, and honestly reports how many tokens you wasted today, this month, and in total.

A DeepSeek Harness plugin whose only purpose is to **genuinely spend twice as much money** and then **honestly** show you the waste.

## Where the idea comes from

The plugin is a direct adaptation of a classic Chinese joke about what it means to be rich:

> 等咱有了钱，喝豆浆吃油条。
> 想蘸白糖蘸白糖，想蘸红糖蘸红糖。
> 豆浆买两碗，喝一碗，倒一碗！
> 油条买两根，吃一根，扔一根！

> *"When we're finally rich, we'll drink soy milk and eat fried dough sticks. Dip them in white sugar if we feel like it, brown sugar if we feel like it. Buy two bowls of soy milk — drink one, pour one out! Buy two dough sticks — eat one, throw one away!"*

The punchline is not the wealth. It is that **the waste is paraded in the open** — you buy two bowls specifically in order to pour one out, and the poured-out bowl is the whole point.

`dsh-i-am-rich` moves that joke into LLM calls, one to one:

| The joke | The plugin |
| --- | --- |
| Buy two bowls of soy milk | Every model request is really sent twice |
| Drink one bowl | The first copy returns to the agent loop — the reply you actually use |
| **Pour one bowl out** | **The second copy is fully received, then discarded outright** |
| White sugar or brown sugar, as you please | `discardedCopies` — pour out as many as you like |
| — | The status bar honestly shows how much was poured out: today / this month / all time |
| — | `enabled: false` — not feeling showy today, so only one bowl of soy milk |

Two deliberate correspondences:

- **The poured-out bowl really is poured out.** The second request genuinely goes over the network, is genuinely billed by the provider, and its content is genuinely dropped. Nothing is simulated, estimated, or faked — the joke only works because the money is really spent, so the plugin really spends it.
- **The poured-out bowl gets counted.** In the joke nobody tallies how much was poured out; this plugin insists on tallying it, and uses only the `usage` the provider itself reported, inventing not a single token. **This is the one entirely serious part of the plugin**: if the money was really spent, the ledger has to be real.

Put another way: **the behaviour is the joke, the ledger is not.** Spending double is a gag. Recording that double spend honestly is not.

## What it does

```
one model request
    ├─ copy 1 ──> returned to the agent loop (the reply you actually use)
    └─ copy 2 ──> fully received, then discarded
                     │
                     └─> records the usage the provider reported for it
                              │
                              └─> status bar: Today 120 · This month 1,200 · All time 8,400 tokens
```

Both copies are **real, billed provider requests**. Nothing is simulated or estimated: the second request goes over the network, the provider bills for it, and its content is dropped.

## Install

> This package is currently `private: true` and is **not published to npm**. Install it from source:

```sh
git clone https://github.com/studyzy/dsh-i-am-rich.git
cd dsh-i-am-rich
pnpm install
pnpm run build
```

Then install it into your DSH profile. `dsh plugin` is a pnpm passthrough, so use `add` with a `link:` dependency pointing at the checkout:

```sh
dsh plugin --profile <your-profile> add link:/path/to/dsh-i-am-rich
```

Note: the built-in `desktop` profile is managed exclusively by the Electron application, so `dsh plugin --profile desktop ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. To install into `desktop`, use the app's bundled `runtime/cli/bin/dsh`, or edit `~/.dsh/profiles/desktop/package.json` directly and run a reconcile pass.

Finally, merge `cordis.patch.yml` into your profile:

```yaml
- insert:
    - id: i-am-rich
      name: '@deepseek-ai/dsh-i-am-rich'
```

The `id` must be `i-am-rich`: the runtime id changed with the rename, so a `rich-person` entry in an older config no longer matches and settings such as the disable switch silently stop taking effect.

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

### The three periods

The status bar shows three figures side by side:

| Period | Meaning |
| --- | --- |
| Today | The single local calendar day that is "now". |
| This month | The whole current local calendar month. |
| All time | Every recorded day combined. |

**Why the client computes them:** a projection's `view(state)` receives only state and **cannot see a clock**. "Today" and "this month" depend on the date at read time, so the Host publishes the **per-day ledger** and the client, which owns the clock, selects the ranges. The direct benefit is that the durable fold stays clock-free and therefore strictly replay-reproducible, while the periods stay calendar-correct.

The boundaries are covered by tests: a month rollover (`2025-12-31` is not part of this month), a year rollover (the same month and day last year is not "today"), and a malformed day key — which contributes only to the all-time figure and can never inflate a period it does not belong to.

### The bar is always visible

The status bar **renders from the moment the plugin is mounted**, showing three zeros before anything has been wasted.

This is deliberate. The bar is the plugin's **only** visible evidence that it is mounted at all, and `shell.bottom` **reserves no space for empty content** — so if "no records yet" meant "render nothing", a correctly installed plugin would be **indistinguishable** from one that failed to load. That is exactly what made an early version look like "installed, but doing nothing". The empty state is marked with `data-i-am-rich-waste="empty"`, and the figures stay `0` rather than being hidden.

## Request attribution

Every `llm/waste` record must be attached to **the session that issued the request**. Attribution has two tiers:

1. **The inherited initiator** (`ctx.agents.currentInitiator()`) — the driver chain of the agent that made this call. This is exact, and it is the **only correct source under a multi-agent deployment**: with teammate sessions, subagents, or concurrently-resumed sessions, `agents.list()` returns more than one entry.
2. **The sole live agent** — used outside an initiator boundary, when exactly one agent exists.

Two points, both locked down by regression tests:

- **Attribution is resolved synchronously when the request is issued**, not after the duplicate drains. A duplicate outlives the original request, and if a sibling agent registers in the meantime, resolving afterwards turns the owner into "ambiguous" — silently discarding a record of money that was **really spent**.
- **Several agents are no longer "ambiguous".** An older version recorded nothing at all when `agents.list().length !== 1`, which meant **every request went unrecorded** under a multi-agent deployment.

Only when there is neither an initiator nor exactly one live agent is the record genuinely abandoned — the burn still happens, but it refuses to claim an attribution it cannot justify.

## Known costs

Stated plainly:

1. **The bill really is double.** That is the entire point of the plugin, not a defect.
2. **It is in tension with the harness's `model-visible ⟺ logged` convention.** The duplicate produces real provider billing but has no corresponding `assistant/attempt` in the session log, because its result was dropped. This plugin records that fact durably as a **non-surface** `llm/waste` event instead of pretending it did not happen. Model-visible input therefore remains fully reconstructable; what the extra event records is **spending**, not model context.
3. **Higher latency and rate-limit pressure.** Duplicates are dispatched concurrently with the original request, consuming additional concurrency.

## Why the bar shows only one copy's worth

With `discardedCopies: 2` three requests are sent (one real, two discarded); the status bar counts only **the two discarded ones**. It reports waste, not throughput — tokens you actually used are not waste.

## Development

```sh
pnpm install
pnpm run check    # lint + typecheck + typecheck:tests + test + build
pnpm test
```

The load-bearing test is `invokes the underlying adapter twice` in `tests/i-am-rich.spec.ts`: it counts **how many times the adapter is invoked**. That is the only assertion that proves a second request was really sent — counting downstream listeners does not.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development setup and conventions.

## Layout

```
src/index.ts               Host plugin: hooks llm/stream, sends duplicates, records llm/waste
src/waste.ts               Pure folds: discarded usage into per-day totals and periods
src/projection.ts          wasteLedger projection: publishes the daily ledger to the Web client
src/types.ts               The llm/waste event type (non-surface)
src/brand.ts               WasteId branding for a discard identity
src/client/index.ts        Browser half entry: registers the shell.bottom slot and dictionaries
src/client/StatusBar.tsx   The status bar component
src/client/locales.ts      zh (source of truth) / en dictionaries
src/client/contracts.ts    Deliberately narrow surface for the browser kernel
tests/                     Four specs; 40 cases
cordis.patch.yml           Profile patch that inserts the plugin row
tsdown.config.ts           Dual build: lib/index.js (ESM, Node) + lib/client.js (CJS, browser)
```

## License

MIT
