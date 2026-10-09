# Security Policy

## Intended double spend is not a vulnerability

`@deepseek-ai/dsh-i-am-rich` is a novelty plugin whose **entire purpose** is to
deliberately send a second, fully-billed provider request for every model call
and then throw the response away.

Sending two requests and paying for both is the intended behavior of this
plugin. It is not a bug, not a security issue, and reports of the form "this
plugin doubles my bill" or "this plugin sends requests I did not ask for" will
be closed as working-as-intended.

If you do not want the double spend, set `enabled: false` in the plugin config
(the plugin still loads and the status bar still renders, it just stops
spending), or uninstall the plugin.

## Scope

The following are genuine security concerns and are in scope.

The plugin's Host half runs **inside the harness process** and appends
**durable session events**. Its trust boundary is therefore the session log it
writes to, not the network. Two classes of vulnerability are real here:

- **Forged attribution of `llm/waste` records.** The plugin writes durable
  `llm/waste` events whose purpose is to attribute real observed spend to a
  specific owning session. A flaw that lets one session's spend be attributed to
  another session — or to an agent that did not issue the request — is a genuine
  vulnerability, because it corrupts an accounting record other consumers may
  treat as authoritative.
- **Leakage of prompt content.** Any flaw through which prompt or completion
  content reaches a durable record, a log, or a surface a reader can observe
  would be in scope.

### What the plugin deliberately does *not* record

The plugin is designed to record **token accounting only**, never content. The
durable record type (`LlmWasteEventData` in `src/types.ts`) contains exactly:

- `wasteId` — stable identity of the discard;
- `provider` and `model` — the route the duplicate was sent to;
- `outcome` — whether the duplicate finished or failed;
- `day` — the local calendar day the record was appended on;
- `usage` — the provider's own reported token counts for that call.

It carries **no message content, no prompt text, and no completion text**. This
is a deliberate property of the design, and a change that weakens it should be
treated as a security-relevant regression.

Note that the plugin's discard event is recorded as a **non-surface** session
event: it produces no LLM message and does not enter model-visible context. The
plugin records *spend*, not *context*.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.0.1 (latest) | :white_check_mark: |

There is no long-term-support branch. Only the latest published version is
supported.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security problem.

Preferred channel: open a **private security advisory** through GitHub on the
repository at <https://github.com/studyzy/dsh-i-am-rich/security/advisories/new>.

Fallback: email the maintainer at <studyzy@gmail.com>.

Please include:

- a description of the issue and its security impact;
- the version affected;
- steps to reproduce, or a proof of concept;
- any suggested fix, if you have one.

You can expect an initial acknowledgement, and we will keep you informed as the
report is triaged and fixed. Please give us a reasonable window to release a fix
before public disclosure.
