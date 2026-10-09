/**
 * Browser half of the i-am-rich plugin: the waste status bar.
 *
 * It is the browser counterpart of `src/index.ts`. The Host half records each
 * discarded duplicate request as a durable `llm/waste` event and folds it into
 * the client-visible `wasteLedger` projection; this module renders that value
 * into the sidebar foot, selecting the today, this-month, and all-time periods
 * against the reader's clock.
 *
 * Composition follows the client-plugin contract:
 *
 * - The package declares `dsh.client` in `package.json`, so the browser module
 *   system serves `lib/client.js` and attaches it to the Loader row for the bare
 *   package name. Switching the row off removes the bar with it.
 * - The bar registers into `sidebar.footer.action`, the row the sidebar renders
 *   directly above `sidebar.settings`, which is the seat holding the account
 *   button (the avatar and user name at the bottom left). A contribution here
 *   therefore sits immediately above the user name.
 *   `ui-sidebar` declares that slot, so registration goes through
 *   `slots.inject` and waits for the declaration instead of assuming an apply
 *   order.
 * - Copy reaches the component through the typed dictionary below, never as
 *   hardcoded text.
 *
 * The slot name is load-bearing and was previously wrong. Registering into a
 * slot no bundle declares fails silently: `slots.inject` only ever runs its
 * callback for a declared slot, so the bar was never mounted and the shell
 * showed nothing — indistinguishable from a plugin that failed to load. The
 * name below is transcribed from `ui-sidebar`'s own `children` table.
 *
 * @module @deepseek-ai/dsh-i-am-rich/client
 */

import { en, NS, zh } from './locales.ts'
import { WasteStatusBar } from './StatusBar.tsx'
// Ambient declarations for the browser services this bar uses.
import './contracts.ts'
import type { WasteSlotName } from './contracts.ts'

/**
 * The sidebar foot row this bar occupies.
 *
 * `sidebar.footer.action` is `kind: 'list'`, so this entry sits beside the
 * shell's own foot actions. The sidebar renders the row above the account
 * button rather than replacing it, which is what puts the figures over the
 * user name at the bottom left.
 */
export const SLOT: WasteSlotName = 'sidebar.footer.action'

/** Services this browser half requires. */
export const inject = ['slots', 'locale']

/** Registers the waste status bar into the composer's dock row.
 * @param ctx - client root context.
 */
export function apply(ctx: {
  slots: import('./contracts.ts').SlotsService
  locale: import('./contracts.ts').LocaleService
  effect: (callback: () => unknown, label: string) => unknown
}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'i-am-rich: dictionaries')

  ctx.effect(
    () => ctx.slots.inject(SLOT, () => ctx.slots.register(
      { name: SLOT, locale: NS, id: 'i-am-rich', order: 40 },
      WasteStatusBar as never,
    )),
    'i-am-rich: waste status bar',
  )
}