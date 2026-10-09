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
                              └─> sidebar foot (above the user name): 🪙 Wasted today 120 / Wasted this month 1200 / Wasted all time 8400
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

### Display format: a coin, and 万 / 亿

The bar opens with a coin, and each period is abbreviated to a magnitude the reader can take in at a glance.

**Only today's period shows by default; hovering expands it into three rows, each with its own coin:**

```
at rest:  🪙 Wasted today 31.11M

hovered:  🪙 Wasted today 31.11M
          🪙 Wasted this month 31.11M
          🪙 Wasted all time 31.11M
```

Why today alone at rest: the seat is the sidebar foot above the user name, so the available width is the sidebar's **264–420px (280 by default)**, while three labelled periods on **one line** need roughly **330px** — they simply do not fit at the default width. So the resting state gives one period and hands the detail to hover.

**The expansion is three stacked rows, not one row of three columns**, and width is why: one period per row means the panel only needs the width of its longest single row, so it stays inside the sidebar column. Laid out side by side it would have to size to its content (~330px) and hang outside the sidebar. The expanded panel is therefore `flex-direction: column` with `width: 100%`, lifted out of the flow (`position: relative` plus a background and shadow) so it covers the account button below instead of shoving it around on every hover.

**The coin is rendered once per row**, not shared by the panel: three rows with three coins read as three separate figures rather than one wrapped sentence.

**Every row is `flex-wrap: nowrap`**, so a row never breaks internally — three rows stay three rows, never four.

Hover expansion uses React state (`onMouseEnter` / `onMouseLeave`) rather than a CSS `:hover` rule: **how many periods render is a render decision**, and a selector can restyle a node but cannot conjure the month and all-time `span`s. It also matches what the shell's own foot controls (the account menu) do.

The **collapsed** sidebar is 56px, a width limit that hovering cannot relieve, so the rail **always** shows just `🪙 31.11M` (the label goes too); all three exact counts remain in the tooltip. Wide vs rail is readable from `data-i-am-rich-wide`, and resting vs expanded from `data-i-am-rich-expanded`.

**Each label spells out that the figure is waste; a bare "Today" is not enough.** The bar reports **the discarded copy**, not total spend, and `Today 31.11M` reads as consumption — the exact opposite of what this plugin isolates. So all three labels are full phrases: 今日浪费 / 本月浪费 / 累计浪费 in Chinese, `Wasted today` / `Wasted this month` / `Wasted all time` in English. A test asserts the word is present for every period, so it cannot be shortened back. The resting row keeps the full label too — what changes with hover is the number of periods, not the wording. The collapsed rail is the one exception, where even the label does not fit.

| Size | Shown as | Example |
| --- | --- | --- |
| < 1 thousand | the plain integer | `842` |
| 1 thousand – 1 million | K | `22.5K` |
| 1 million – 1 billion | M | `31.11M` |
| ≥ 1 billion | B | `2.5B` |

The rule is **always the largest unit that fits**, rather than a fixed "billions + millions" pair — that would spell 31 million as the awkward `0B31M`. Rounding happens once, on the way out, and may **carry a figure up into the next unit**: `999,999,999` shows as `1B`, not `1000M`.

Scaling affects the bar only. Hovering reveals the **exact integers** with thousands separators, because scaling is a presentation choice and the ledger is the record:

```
Today 31,114,724 · This month 31,114,724 · All time 31,114,724
```

Chinese does **not** use K/M/B, and English does **not** borrow 万/亿 — each dictionary groups large numbers the way its readers do, so `zh` shows `3111万` and `en` shows `31.11M`. Which family is in use is readable from the `data-i-am-rich-scale` attribute (`zh` / `en`) on the bar.

### The bar is always visible

The status bar **renders from the moment the plugin is mounted**, showing three zeros before anything has been wasted.

This is deliberate. The bar is the plugin's **only** visible evidence that it is mounted at all, and a sidebar entry that renders nothing is **indistinguishable** from a plugin that failed to load — so if "no records yet" meant "render nothing", there would be no way to tell "mounted correctly" from "never mounted". That is exactly what made an early version look like "installed, but doing nothing". The empty state is marked with `data-i-am-rich-waste="empty"`, and the figures stay `0` rather than being hidden.

The bar registers into `sidebar.footer.action` (`kind: list`, declared by `ui-sidebar`), the row at the sidebar foot, **directly above the user name** (the account button). The sidebar renders `footerActions` and then `settingsArea` in one column, and the account button — avatar plus user name — is the `sidebar.settings` entry inside `settingsArea`, so this cell lands on top of the user name by construction. **The slot name is load-bearing**: `slots.inject` only ever runs its callback for a slot some bundle actually declares, so registering into an undeclared slot neither throws nor renders — which is precisely why this plugin once looked "installed but invisible".

That seat is **root-scoped**, so the shell hands it no `sessionId`; the bar picks the current session out of the store itself, by `retainedBy.mainView > 0`. That is the shell's own test for "the main view is showing this session" — `ui-layout` selects the document title by exactly the same condition — so the bar reuses it rather than inventing a second definition of "current session".

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
src/waste.ts               Pure folds: discarded usage into per-day totals and periods, scaled to a readable magnitude
src/projection.ts          wasteLedger projection: publishes the daily ledger to the Web client
src/types.ts               The llm/waste event type (non-surface)
src/brand.ts               WasteId branding for a discard identity
src/client/index.ts        Browser half entry: registers the sidebar.footer.action slot and dictionaries
src/client/StatusBar.tsx   The status bar (stateless view + hover wrapper)
src/client/locales.ts      zh (source of truth) / en dictionaries
src/client/contracts.ts    Deliberately narrow surface for the browser kernel
tests/                     Five specs; 78 cases
cordis.patch.yml           Profile patch that inserts the plugin row
tsdown.config.ts           Dual build: lib/index.js (ESM, Node) + lib/client.js (CJS, browser)
```

## License

MIT
