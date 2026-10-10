# dsh-i-am-rich

[![npm version](https://img.shields.io/npm/v/@studyzy/dsh-i-am-rich.svg)](https://www.npmjs.com/package/@studyzy/dsh-i-am-rich)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/@studyzy/dsh-i-am-rich.svg)](https://www.npmjs.com/package/@studyzy/dsh-i-am-rich)

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
                              └─> sidebar foot (above the user name): 💰 Wasted today 120 tokens / Wasted this month 1200 tokens / Wasted all time 8400 tokens
```

Both copies are **real, billed provider requests**. Nothing is simulated or estimated: the second request goes over the network, the provider bills for it, and its content is dropped.

The discarded usage is recorded in **the plugin's own ledger directory** (`~/.dsh/i-am-rich/`, one JSONL file per month) and **never written into the dsh session log** — "the behavior is a joke, the ledger is a ledger", but the ledger does not belong inside someone else's log. Format and location are described under "Data storage" below.

## Install

Published to npm — install it directly:

```sh
dsh plugin --profile <your-profile> add @studyzy/dsh-i-am-rich
```

Or install from source:

```sh
git clone https://github.com/studyzy/dsh-i-am-rich.git
cd dsh-i-am-rich
pnpm install
pnpm run build
```

Then install it into your DSH profile. `dsh plugin` is a pnpm passthrough, so when installing from source use `add` with a `link:` dependency pointing at the checkout:

```sh
dsh plugin --profile <your-profile> add link:/path/to/dsh-i-am-rich
```

Note: the built-in `desktop` profile is managed exclusively by the Electron application, so `dsh plugin --profile desktop ...` is rejected with `profile "desktop" is managed exclusively by the Electron application`. To install into `desktop`, use the app's bundled `runtime/cli/bin/dsh`, or edit `~/.dsh/profiles/desktop/package.json` directly and run a reconcile pass.

Finally, merge `cordis.patch.yml` into your profile:

```yaml
- insert:
    - id: i-am-rich
      name: '@studyzy/dsh-i-am-rich'
```

The `id` must be `i-am-rich`: the runtime id changed with the rename, so a `rich-person` entry in an older config no longer matches and settings such as the disable switch silently stop taking effect.

## Configuration

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether requests are duplicated. Turning it off leaves the plugin loaded and the status bar live, but stops spending. |
| `discardedCopies` | number | `1` | How many extra copies to discard per request. `1` sends twice and throws one away. |
| `fortune` | `millionaire` \| `billionaire` | `millionaire` | The fortune tier, which decides how expensive the discarded copy is. See below. |

```yaml
- id: i-am-rich
  name: '@studyzy/dsh-i-am-rich'
  config:
    enabled: true
    discardedCopies: 1
    fortune: millionaire
```

### Fortune tiers: millionaire / billionaire

The two tiers differ not in *how many* copies are sent but in whether the second request's prompt **prefix** matches the first — that is, whether it can ride the provider's prompt cache.

| Tier | The second request | Cache | Billing |
| --- | --- | --- | --- |
| Millionaire | **Identical** to the original (the same request object) | Usually hits | Cache **read** rate (cheap) |
| Billionaire | A **current timestamp** written into the head of the system prompt | Always **misses** | Cache **write** rate (far more expensive) |

**Why the prefix decides the price:** a provider's prompt cache matches on the **prefix**. When two requests share a byte-identical prefix, the second reuses the cache entry the first wrote and is billed at the cache-read rate; change the leading text and the whole prefix fails to match, so the second request is billed as a fresh cache **write** — the input side goes from discounted to premium, and that is the mechanism that makes the billionaire tier cost more. A timestamp satisfies this by construction: **every dispatch differs**, so even two duplicates of the same request cannot share a cache entry.

**The stamp goes into the existing system prompt, adding no message.** That is the load-bearing trade. The earlier shape **inserted a prefix message** at the front of `messages`, which meant rebuilding the entire `messages` array on every dispatch — and that array carries the whole conversation, making it the single largest object in a request once a session is long (~11.6 MB for 3000 messages, measured). Writing one line into the head of the existing system message instead leaves the message count identical and reuses every other message **by object identity**. On the same payload, constructing 200 dispatches dropped from 3.6ms to 0.6ms.

**Injection must clone, never mutate.** A loop-built `GenerateOptions.messages` arrives **deep-frozen** (`freezeMessage` in `dsh-llm` does `deepFreeze(structuredClone(...))`), so writing into the caller's array would throw outright — and would edit the request the **real turn** is using. The billionaire tier therefore clones the request and replaces only that one system message, leaving the original bit-for-bit unchanged (a test asserts exactly that). The system message's `id`/`source` and any non-text blocks are carried over; only the leading text block is rewritten.

**A request with no system message degrades honestly.** A system-role entry must be a **durable** `Message` carrying an `id` and a `source` (only `role: 'user'` may be the identity-free one-shot `RequestUserInput`), and minting a durable identity for a throwaway copy is precisely what this plugin must not do. Such a request therefore falls back to sending the second copy unchanged — **still a real billed call**, only with the cache hitting. That is reported honestly rather than pretended. Loop-built requests always carry a system message, so this is the hand-built one-shot shape, not the normal path.

**That requires a re-entrancy guard.** Making the prefix take effect means re-dispatching a different request object, and `next()` accepts no argument (it only replays the one it closed over), so the only route is `ctx.llm.stream()` — which passes through the `llm/stream` waterfall again and re-enters this plugin's own listener. The plugin therefore marks its own dispatch in a module-level **`WeakSet`**, keyed by object identity: the stamped clone is registered before dispatch, and the listener passes its own duplicates straight through without duplicating, since otherwise it would recurse forever. Identity rather than a global flag, because a flag is only correct under the timing assumption that the nested dispatch re-enters the listener synchronously — precisely the most fragile assumption inside a real harness. An identity marker has no timing dependency at all: the clone is recognized whenever and however it re-enters, concurrent requests each mark their own clone, and originals can never match because identity is unique. Tests run in the realistic shape (`llm` provided through the service registry, its `stream` re-running the waterfall) and assert the stamped clone reaches the inner dispatch exactly once and the original request object stays untouched.

**Graceful degradation without an `llm` service.** The prefix cannot be injected, so the plugin falls back to sending the second copy unchanged — **still a real billed call**, only without the prefix. That is reported honestly rather than pretended.

**The tier is selected at the top of the bar's expanded panel** as a radio group (Millionaire / Billionaire), with a tooltip explaining the mechanism.

In the layout, the "Fortune" legend and the two options occupy separate lines, while **the two options themselves sit side by side on one row**: they are a single either/or, and they read as one control only when adjacent. That row uses `flex-wrap: wrap` rather than `nowrap`, so a very narrow sidebar **stacks them onto two lines** instead of pushing "Billionaire" out of the column. The save status is a third line, present only when there is something to say.

The selection does **not** move on the click: the radio advances only once the Host confirms the write succeeded. On failure it stays on the tier **actually in effect** and says "Could not save; still on the previous tier" — a display that disagrees with the real behavior is exactly what this plugin exists to prevent.

The choice is written to the profile's `cordis.patch.yml` (through DSH's official `ctx.configEditor.edit`, which locks the document, validates, and rolls back on failure), so it **survives a restart**. Only the `fortune` field is changed; every other setting — including `discardedCopies`, which is real money — is preserved.

`configEditor` is deliberately **not** in `inject`: cordis withholds `apply` until an injected service exists, so declaring it would make a harness without the editor lose the duplication and the ledger entirely. It is read through `ctx.get()` instead — available when present, and the plugin works either way, with only the tier failing to persist.

## How the numbers are computed

Every figure in the status bar is **usage the provider itself reported**. Nothing is estimated, scaled, or invented:

- Only discards whose provider reported `usage` contribute tokens.
- A discard the provider did not price is counted separately as an unpriced call, and **claims no tokens**.
- A duplicate that failed mid-stream after reporting usage still contributes that usage, because the money was really spent.
- **Cache tokens are excluded from the displayed figure, which counts exactly two numbers: cache-miss input plus generated output.**
  Cache hits are billed at the provider's steep discount — often an order of magnitude below a fresh input token — so a duplicate that rode the warm prompt cache (the entire point of the `millionaire` tier) costs next to nothing per token; a cache write is the input prefix itself being parked, not anything new the duplicate produced. Counting either would inflate the number without representing real extravagance.
  All four buckets are still recorded in the ledger in full — this is a presentation choice; the record itself remains the complete, honest provider-reported usage.

Totals are bucketed by local calendar day. The day is stamped when the Host appends the record, so **replay produces exactly the figures seen live** and does not depend on a clock at read time.

### The three periods

The status bar shows three figures side by side:

| Period | Meaning |
| --- | --- |
| Today | The single local calendar day that is "now". |
| This month | The whole current local calendar month. |
| All time | Every recorded day combined. |

**Why the client computes them:** the served ledger carries days and **cannot see a clock**. "Today" and "this month" depend on the date at read time, so the Host publishes the **per-day ledger** and the client, which owns the clock, selects the ranges. The direct benefit is that the fold stays clock-free and therefore strictly reproducible, while the periods stay calendar-correct.

The boundaries are covered by tests: a month rollover (`2025-12-31` is not part of this month), a year rollover (the same month and day last year is not "today"), and a malformed day key — which contributes only to the all-time figure and can never inflate a period it does not belong to.

### Display format: a money bag, and 万 / 亿

The bar opens with a money bag, and each period is abbreviated to a magnitude the reader can take in at a glance.

**Only today's period shows by default; hovering expands it into three rows, each with its own money bag:**

```
at rest:  💰 Wasted today 31.11Mtokens

hovered:  💰 Wasted today 31.11Mtokens
          💰 Wasted this month 31.11Mtokens
          💰 Wasted all time 31.11Mtokens
```

Why today alone at rest: the seat is the sidebar foot above the user name, so the available width is the sidebar's **264–420px (280 by default)**, while three labelled periods on **one line** need roughly **330px** — they simply do not fit at the default width. So the resting state gives one period and hands the detail to hover.

**The expansion is three stacked rows, not one row of three columns**, and width is why: one period per row means the panel only needs the width of its longest single row, so it stays inside the sidebar column. Laid out side by side it would have to size to its content (~330px) and hang outside the sidebar. The expanded panel is therefore `flex-direction: column` with `width: 100%`, lifted out of the flow (`position: relative` plus a background and shadow) so it covers the account button below instead of shoving it around on every hover.

**The money bag is rendered once per row**, not shared by the panel: three rows with three bags read as three separate figures rather than one wrapped sentence.

**Every row is `flex-wrap: nowrap`**, so a row never breaks internally — three rows stay three rows, never four.

Hover expansion uses React state (`onMouseEnter` / `onMouseLeave`) rather than a CSS `:hover` rule: **how many periods render is a render decision**, and a selector can restyle a node but cannot conjure the month and all-time `span`s. It also matches what the shell's own foot controls (the account menu) do.

The **collapsed** sidebar is 56px, a width limit that hovering cannot relieve, so the rail **always** shows just `💰 31.11Mtokens` (the "Wasted today" label goes too); all three exact counts remain in the tooltip. Wide vs rail is readable from `data-i-am-rich-wide`, and resting vs expanded from `data-i-am-rich-expanded`.

**The type scale and colours match the user name directly below.** The bar sits immediately above the account button (avatar plus user name), and the two read as a pair: both are `font-size: 14px` / `line-height: 22px`, both use `6px` padding, and both use `--dsw-alias-label-primary`. These values are not estimates — they are transcribed rule by rule from the `AccountMenu` styles in `dsh-client-ui-settings-account`, the package that owns the account button.

The reason for the change is that the bar was **too small and too grey**: 12px, `--dsw-text-secondary`, with the label further dimmed by `opacity: 0.7`. "Wasted today" read as a caption rather than a peer of the user name — and it is not a caption; it is a permanent control in the same column, exactly like the user name.

The money bag uses `font-size: 1em` rather than a fixed pixel value: the glyph then follows the row's font size, so **the icon and the label stay the same size** and cannot drift apart if the bar's type is ever resized. The figure itself keeps `--dsw-text-primary` and `font-weight: 500`, so within a row the number still leads and the label follows — the hierarchy is not flattened.

**The glyph is 💰 (money bag), not 🪙.** U+1FA99 is literally named COIN, but Apple renders it as a **pale, silver-toned generic coin** that reads as a token rather than as money. U+1F4B0 is unmistakably gold on the same font, which is what the "rich person" theme calls for.

**The gap between the glyph and the text is a `marginRight` on the icon, not a character in the string.** The row's `gap` is shared by every child, so widening it would push the label away from the figure and the figure away from its unit as well — three gaps changed to fix one. The spacing therefore lives on the icon's own `marginRight`, and it is deliberately not a trailing space inside `COIN`, so the tooltip, a copied figure, and a test reading the text all get a clean glyph.

**Each label spells out that the figure is waste; a bare "Today" is not enough.** The bar reports **the discarded copy**, not total spend, and `Today 31.11M` reads as consumption — the exact opposite of what this plugin isolates. So all three labels are full phrases: 今日浪费 / 本月浪费 / 累计浪费 in Chinese, `Wasted today` / `Wasted this month` / `Wasted all time` in English. A test asserts the word is present for every period, so it cannot be shortened back. The resting row keeps the full label too — what changes with hover is the number of periods, not the wording. The collapsed rail is the one exception, where even the label does not fit.

| Size | Shown as | Example |
| --- | --- | --- |
| < 1 thousand | the plain integer | `842` |
| 1 thousand – 1 million | K | `22.5K` |
| 1 million – 1 billion | M | `31.11M` |
| ≥ 1 billion | B | `2.5B` |

The rule is **always the largest unit that fits**, rather than a fixed "billions + millions" pair — that would spell 31 million as the awkward `0B31M`. Rounding happens once, on the way out, and may **carry a figure up into the next unit**: `999,999,999` shows as `1B`, not `1000M`.

**The magnitude unit is followed by the word `tokens`.** K/M/B says how *big* the number is, not what it is a number *of*: `Wasted today 31.11M` reads as a money amount, which is exactly the misreading this plugin exists to prevent, so the thing being counted is named. It comes from the `waste.unit` dictionary key (`Token` in Chinese, `tokens` in English) and **always shows** — including in the 56px rail, where the "Wasted today" label is dropped but `tokens` stays, since a bare `💰 31.11M` would read as money again. It is separated from the magnitude by a dedicated `marginLeft`, for the same reason the money bag carries its own spacing: the row's `gap` is shared by every child.

Scaling affects the bar only. Hovering reveals the **exact integers** with thousands separators, because scaling is a presentation choice and the ledger is the record:

```
Today 31,114,724 · This month 31,114,724 · All time 31,114,724
```

Chinese does **not** use K/M/B, and English does **not** borrow 万/亿 — each dictionary groups large numbers the way its readers do, so `zh` shows `3111万` and `en` shows `31.11M`. Which family is in use is readable from the `data-i-am-rich-scale` attribute (`zh` / `en`) on the bar.

### The bar is always visible

The status bar **renders from the moment the plugin is mounted**, showing three zeros before anything has been wasted.

This is deliberate. The bar is the plugin's **only** visible evidence that it is mounted at all, and a sidebar entry that renders nothing is **indistinguishable** from a plugin that failed to load — so if "no records yet" meant "render nothing", there would be no way to tell "mounted correctly" from "never mounted". That is exactly what made an early version look like "installed, but doing nothing". The empty state is marked with `data-i-am-rich-waste="empty"`, and the figures stay `0` rather than being hidden.

The bar registers into `sidebar.footer.action` (`kind: list`, declared by `ui-sidebar`), the row at the sidebar foot, **directly above the user name** (the account button). The sidebar renders `footerActions` and then `settingsArea` in one column, and the account button — avatar plus user name — is the `sidebar.settings` entry inside `settingsArea`, so this cell lands on top of the user name by construction. **The slot name is load-bearing**: `slots.inject` only ever runs its callback for a slot some bundle actually declares, so registering into an undeclared slot neither throws nor renders — which is precisely why this plugin once looked "installed but invisible".

Data does not travel through the session store: the bar fetches the ledger once on mount, then **polls every 15 seconds**, and polls again when the tab becomes visible again. When a poll fails the bar **keeps the last successful figures** and notes "ledger unavailable" in the tooltip — it never silently resets to zero, because frozen numbers must be recognizable as frozen.

## Data storage

The waste ledger lives in a **standalone directory** and is never written into the dsh session log:

```
$DSH_HOME/i-am-rich/waste-YYYY-MM.jsonl      # DSH_HOME defaults to ~/.dsh
```

- One **append-only** JSONL file per month, one line per discarded request:
  ```json
  {"v":1,"wasteId":"…","provider":"deepseek","model":"…","outcome":"discarded","day":"2026-10-10","usage":{"inputTokens":100,"outputTokens":20}}
  ```
  `v` is the line-format version; only `day` and `usage` take part in the fold — `wasteId`/`provider`/`model`/`outcome` are human-readable facts.
- The Host publishes the folded per-day ledger to the browser at `GET /api/i-am-rich/waste` (with a 1-second read cache, so several polling tabs share one disk read).
- A crash can leave at most a **trailing partial line**; the reader skips lines that fail validation, so one bad line never swallows the rest of a month's accounting.
- Appends are single-line `O_APPEND` writes, atomic in practice on local file systems; **the ledger is designed for a single instance** and takes no cross-process lock.
- **Historical waste records in old session logs are no longer read**: once the ledger moved to its own directory, old records are neither migrated nor merged; the figures start fresh from the new files.

## Known costs

Stated plainly:

1. **The bill really is double.** That is the entire point of the plugin, not a defect.
2. **Duplicates are not in the session log.** The ledger lives in its own directory (see "Data storage" above) and the session log stays completely clean — the trade-off is that "what a given session wasted at the time" cannot be traced per session; the ledger has only a global view.
3. **Higher latency and rate-limit pressure.** Duplicates are dispatched concurrently with the original request, consuming additional concurrency.

## Version requirements

Recording no longer depends on any harness session-logging API. The host must provide:

- a writable user directory (`DSH_HOME` or `~/.dsh`, created automatically when absent);
- the Web UI's `connection` service (which carries the `/api` route). In a headless environment without it, the plugin **still sends duplicates and still writes ledger files**; only the status bar has nothing to poll, and the condition is warned about once.

`connection` is **declared in `inject`**, not read directly:

```ts
export const inject = ['connection']
```

Getting this wrong once cost the status bar: it showed `0` forever. On an **activated** plugin fiber, cordis **throws** when a service that was never injected is read
(`cannot get property "connection" without inject`) rather than returning `undefined`.
The old code caught that throw and treated it as "this host has no Web client" — so the `/api/i-am-rich/waste` route was never registered
while the ledger file kept being written normally. Both situations look identical in the UI (the bar simply never moves), which is why the bug stayed silent
and was first misdiagnosed as a stale client cache or a failed fetch.

Declaring `inject` fixes two things at once: the read becomes legal, and cordis waits for `connection` before calling `apply`,
removing the startup-order race created by the plugin's `insert` position. The regression is pinned by `tests/ledger-server.spec.ts`,
which reproduces the `without inject` throw on a real cordis fiber and asserts the route actually reaches `connection.fetch.register`.

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
src/index.ts               Host plugin: hooks llm/stream, sends duplicates, appends the ledger, registers the /api route
src/waste.ts               Pure folds: discarded usage into per-day totals and periods, scaled to a readable magnitude
src/ledger-file.ts         The standalone ledger files: the only read/write path for the monthly JSONL (DSH_HOME/i-am-rich)
src/ledger-server.ts       The /api/i-am-rich/waste route: the day-keyed ledger with a 1-second read cache
src/types.ts               Ledger line types (non-surface) and the line-format version
src/brand.ts               WasteId branding for a discard identity
src/client/index.ts        Browser half entry: registers the sidebar.footer.action slot and dictionaries
src/client/StatusBar.tsx   The status bar (stateless view + hover and polling wrapper)
src/client/locales.ts      zh (source of truth) / en dictionaries
src/client/contracts.ts    Deliberately narrow surface for the browser kernel
tests/                     Five specs
cordis.patch.yml           Profile patch that inserts the plugin row
tsdown.config.ts           Dual build: lib/index.js (ESM, Node) + lib/client.js (CJS, browser)
```

## License

MIT
