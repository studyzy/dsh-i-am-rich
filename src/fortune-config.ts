/**
 * Persisting the fortune tier into the profile's own configuration.
 *
 * The tier is a plugin config field, so the only durable place for it is the
 * profile patch the Loader already reads. Rather than editing YAML directly —
 * which would race the Loader's hot reload and skip validation — this defers to
 * the harness `configEditor` service, which locks the profile document, applies
 * the change through the normal config waterfall, reloads the plugin, and rolls
 * the file back if the reload fails.
 *
 * Everything here is runtime feature detection, not a version check: a harness
 * without `configEditor` (or without a fiber entry) still burns requests and
 * still records the ledger, it simply cannot persist the choice, and that is
 * reported rather than silently swallowed.
 *
 * @module @studyzy/dsh-i-am-rich/fortune-config
 */

import type { Config } from './index.ts'
import type { FortuneTier } from './types.ts'

/**
 * The subset of the harness `configEditor` service this plugin uses.
 *
 * Declared structurally rather than imported from the harness package: this
 * package runs outside the harness workspace (see `brand.ts` for the same
 * reasoning), and under-declaring keeps the code coupled to the contract it
 * actually calls instead of to a released version of it.
 */
export interface ConfigEditorService {
  /**
   * Persist a plugin's next config and reconcile the Loader.
   * @param entry - the Loader entry being edited.
   * @param change - derives the next raw config from the current and inherited ones.
   * @returns fulfillment once the Loader reconciliation completes.
   */
  readonly edit: (
    entry: unknown,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ) => Promise<void>
}

/**
 * What the fortune writer needs from a context to persist a tier.
 *
 * `fiber.entry` is declared here rather than imported: the Loader augments the
 * cordis `Fiber` with it, and this package does not depend on the Loader (it is
 * supplied by the harness at runtime). Typed as `unknown` because the editor is
 * the only thing that may interpret it — this plugin must never reach into a
 * Loader entry's internals.
 */
export interface FortuneWriterContext {
  /** The plugin's own Loader entry, absent when not loaded through a profile. */
  readonly fiber?: { readonly entry?: unknown } | undefined
  /**
   * Resolve a service by name.
   * @param name - service name.
   * @returns the service, or undefined when this harness does not provide it.
   */
  get(name: string): unknown
}

/**
 * Narrow a plugin context to what {@link createFortuneWriter} needs.
 *
 * A cast rather than a direct pass because cordis types `fiber` as its own
 * `Fiber` class, which does not include the `entry` the Loader mixes in — the
 * property is real at runtime, and this is the one place that fact is asserted.
 * @param ctx - the plugin context.
 * @returns the same context, viewed as a fortune-writer context.
 */
export function asFortuneWriterContext(ctx: unknown): FortuneWriterContext {
  return ctx as FortuneWriterContext
}

/**
 * Build the tier writer bound to one context.
 *
 * The writer reads the plugin's **current** config at write time and changes
 * only `fortune`. Replacing the whole config object instead would silently
 * reset any field this plugin gains later, and would drop tuning the user had
 * set by hand in the same document.
 * @param ctx - the plugin context holding the fiber entry and services.
 * @returns a writer that persists one tier, or rejects when it cannot.
 */
export function createFortuneWriter(ctx: FortuneWriterContext): (fortune: FortuneTier) => Promise<void> {
  return async (fortune: FortuneTier): Promise<void> => {
    const entry = ctx.fiber?.entry
    if (entry === undefined) throw new Error('this plugin was not loaded from a profile entry, so the choice cannot be persisted')
    const editor = ctx.get('configEditor') as ConfigEditorService | undefined
    if (editor === undefined) throw new Error('this harness has no configEditor service, so the choice cannot be persisted')
    await editor.edit(entry, current => ({ ...current, fortune }) as unknown as Record<string, unknown>)
  }
}

/**
 * Read the currently configured tier from a resolved config.
 *
 * Used to answer the client's "which radio is selected" question from the same
 * value the burn uses, so the choice shown and the behavior in effect cannot
 * disagree.
 * @param config - the resolved plugin config.
 * @returns the tier in effect.
 */
export function currentFortune(config: Pick<Config, 'fortune'>): FortuneTier {
  return config.fortune
}