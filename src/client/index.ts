/**
 * Browser half of the i-am-rich plugin: the waste status bar.
 *
 * It is the browser counterpart of `src/index.ts`. The Host half records each
 * discarded duplicate request as a durable `llm/waste` event and folds it into
 * the client-visible `wasteToday` projection; this module renders that value
 * into the shell's bottom bar.
 *
 * Composition follows the client-plugin contract:
 *
 * - The package declares `dsh.client` in `package.json`, so the browser module
 *   system serves `lib/client.js` and attaches it to the Loader row for the bare
 *   package name. Switching the row off removes the bar with it.
 * - The bar registers into `shell.bottom`, the root-scope single slot the shell
 *   renders below the main row. `ui-layout` declares that slot, so registration
 *   goes through `slots.inject` and waits for the declaration instead of
 *   assuming an apply order.
 * - Copy reaches the component through the typed dictionary below, never as
 *   hardcoded text.
 *
 * @module @deepseek-ai/dsh-i-am-rich/client
 */

import { en, NS, zh } from './locales.ts'
import { WasteStatusBar } from './StatusBar.tsx'
// Ambient declarations for the browser services this bar uses.
import './contracts.ts'

/** Services this browser half requires. */
export const inject = ['slots', 'locale']

/** Registers the waste status bar into the shell's bottom row.
 * @param ctx - client root context.
 */
export function apply(ctx: {
  slots: import('./contracts.ts').SlotsService
  locale: import('./contracts.ts').LocaleService
  effect: (callback: () => unknown, label: string) => unknown
}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'i-am-rich: dictionaries')

  ctx.effect(
    () => ctx.slots.inject('shell.bottom', () => ctx.slots.register(
      { name: 'shell.bottom', locale: NS },
      WasteStatusBar as never,
    )),
    'i-am-rich: waste status bar',
  )
}