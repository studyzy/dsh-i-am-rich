/**
 * Typed surface of the browser kernel this plugin's client half talks to.
 *
 * The client bundle resolves these as *externals* against the module table the
 * shell seeds, so they are real runtime imports. What they are not is a build
 * dependency: this package ships a Host-facing plugin, and depending on the
 * `@deepseek-ai/dsh-client-*` stack would force every headless consumer to
 * install the entire browser stack for a status bar it will never render.
 *
 * The members this status bar uses are declared here, deliberately narrow:
 * under-declaring keeps the code coupled to the contract it relies on rather
 * than to a released version of it.
 *
 * @module @deepseek-ai/dsh-i-am-rich/client/contracts
 */

/** A component the slot renderer can mount. */
export type SlotComponent<P> = (props: P) => unknown

/** The discarded-usage ledger this plugin's Host half publishes per session. */
export interface WasteLedgerView {
  /** Every day the session recorded discarded usage on, keyed `YYYY-MM-DD`. */
  readonly days: Record<string, WasteTotals>
}

/** One day's discarded-token buckets, as published over the wire. */
export interface WasteTotals {
  readonly pricedCalls: number
  readonly unpricedCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** One session's projection values, keyed by registered projection key. */
export interface SessionLike {
  readonly projectionValues?: Record<string, unknown> | undefined
  /**
   * How many surfaces currently retain this session, by surface name.
   *
   * The sidebar is a root-scope slot and receives no `sessionId`, so the bar
   * identifies the session the main view is showing by this counter alone.
   * `mainView > 0` is the shell's own idiom for "this is the active session",
   * used verbatim by `ui-layout`'s document-title projection.
   */
  readonly retainedBy?: Record<string, number | undefined> | undefined
}

/** State shape the session store exposes to `useSessions` selectors. */
export interface SessionsState {
  readonly byId: Record<string, SessionLike | undefined>
}

/**
 * The slot this bar registers into.
 *
 * `sidebar.footer.action` is the sidebar's foot row, and it is `kind: 'list'`,
 * so this entry is added beside the shipped entries rather than replacing one.
 * The shell renders that row directly **above** `sidebar.settings`, which is
 * the seat holding the account button (the avatar and user name at the bottom
 * left) — so a contribution here sits immediately above the user name.
 *
 * It is declared by `@deepseek-ai/dsh-client-ui-sidebar`'s own `children` table.
 * The name is spelled out here rather than imported: this package ships a
 * Host-facing plugin, and a browser type package would drag the whole UI stack
 * into every headless install that never renders the bar.
 */
export type WasteSlotName = 'sidebar.footer.action'

/** The slot registration options this plugin passes. */
export interface SlotRegistration {
  readonly name: WasteSlotName
  readonly locale: string
  /** Stable entry id within the slot's list. */
  readonly id: string
  /** Sort position among the slot's entries. */
  readonly order: number
}

/** The slots service members used by this plugin. */
export interface SlotsService {
  /**
   * Run `contribute` once the named slot is declared, and again after every
   * declaration epoch change. A slot that is never declared never runs it — so
   * the name must be one the shell actually declares, or the contribution is
   * dropped silently.
   * @param name - the slot to wait for.
   * @param contribute - registers the contribution once declared.
   * @returns the disposer.
   */
  inject(name: WasteSlotName, contribute: () => unknown): () => void
  /**
   * Contribute a component to a declared slot.
   * @param options - the registration options.
   * @param component - the component to mount.
   * @returns the disposer.
   */
  register(options: SlotRegistration, component: SlotComponent<unknown>): () => void
}

/** The locale service members used by this plugin. */
export interface LocaleService {
  /**
   * Register dictionaries for a namespace.
   * @param namespace - the namespace to own.
   * @param dictionaries - the per-language dictionaries.
   * @returns the disposer.
   */
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
}

/** Session events observed by the React hook the status bar selects over. */
export interface SessionsHook {
  /**
   * Select a value derived from the session store.
   * @param selector - pure derivation over the store state.
   * @returns the selected value.
   */
  <T>(selector: (state: SessionsState) => T): T
}

/** Props the shell supplies to a `sidebar.footer.action` contribution. */
export interface WasteDockProps {
  /** Standing seat: the session store hook. */
  readonly useSessions: SessionsHook
  /**
   * Owner share: whether the sidebar renders wide content.
   *
   * The slot's own owner prop. `false` is the collapsed 56px rail, where the
   * three "wasted" labels do not fit and the bar keeps only the coin and the
   * three figures.
   */
  readonly wide: boolean
  /** Translation seat for this registration's locale namespace. */
  readonly t: (key: string, params?: Record<string, unknown>) => string
}