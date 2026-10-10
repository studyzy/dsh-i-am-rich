/**
 * Behavior of the fortune tiers: what each tier actually sends.
 *
 * The load-bearing property is that the billionaire tier's duplicate carries a
 * *different* prompt prefix while the original request is left untouched — that
 * difference is the entire mechanism, since a shared prefix is what lets a
 * provider serve the duplicate from cache.
 *
 * The stamp lives in the head of the existing system message rather than in a
 * message of its own: prepending a message rebuilt the whole `messages` array
 * on every dispatch, and that array is the largest object in a long request.
 * The cases below therefore pin both halves — the prefix really differs, and
 * the message count really did not change.
 */

import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm/types'
import { billionaireStamp, duplicateRequest, FORTUNE_TIERS } from '../src/index.ts'

/** A frozen request shaped like a loop-built one. */
function frozenOptions(): GenerateOptions {
  const options: GenerateOptions = {
    provider: 'test',
    model: 'test-model',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ],
  }
  // Loop-built requests arrive deep-frozen; reproducing that here is what makes
  // the "never mutated" assertion below meaningful rather than decorative.
  return Object.freeze({
    ...options,
    messages: Object.freeze(options.messages.map(m => Object.freeze({ ...m, content: Object.freeze(m.content) }))),
  }) as GenerateOptions
}

/** The instant the stamps in these cases are built from. */
const AT = new Date('2026-10-10T06:00:00.000Z')

describe('fortune tiers', () => {
  it('lists the tiers in ascending order of spend', () => {
    expect(FORTUNE_TIERS).toEqual(['millionaire', 'billionaire'])
  })

  it('sends the millionaire duplicate verbatim, as the same request object', () => {
    const options = frozenOptions()
    const { options: duplicate, prefixed } = duplicateRequest(options, 'millionaire', AT)

    // Identity, not just equality: the cheap tier must not copy the request at
    // all, because a copy is what a provider would have to re-read uncached.
    expect(duplicate).toBe(options)
    expect(prefixed).toBe(false)
  })

  it('stamps the system prompt head for the billionaire duplicate without mutating the original', () => {
    const options = frozenOptions()
    const before = structuredClone(options)
    const { options: duplicate, prefixed } = duplicateRequest(options, 'billionaire', AT)

    expect(prefixed).toBe(true)
    expect(duplicate).not.toBe(options)

    // The mechanism: the duplicate's leading text differs, so the prompt prefix
    // differs, so the provider cannot reuse the original's cache entry.
    const system = duplicate.messages[0]!
    expect(system.role).toBe('system')
    expect(system.content[0]).toEqual({ type: 'text', text: billionaireStamp(AT) })
    // The original system text survives behind the stamp, so the duplicate asks
    // the same question with a different cache key — not a different question.
    expect(system.content[1]).toEqual({ type: 'text', text: 'system prompt' })

    // The caller's request is bit-for-bit what it was: the real turn still runs
    // on it, and a mutated prefix would have changed what the model sees.
    expect(options).toEqual(before)
  })

  it('keeps the message count identical, which is what avoids rebuilding the array', () => {
    const options = frozenOptions()
    const { options: duplicate } = duplicateRequest(options, 'billionaire', AT)

    // The whole point of stamping in place: an inserted message would have made
    // this `+ 1` and forced a copy of the entire conversation per dispatch.
    expect(duplicate.messages).toHaveLength(options.messages.length)
    // Every message but the stamped one is the very same object, not a copy.
    expect(duplicate.messages[1]).toBe(options.messages[1])
  })

  it('stamps a different value on every dispatch, so no two duplicates share a cache entry', () => {
    const options = frozenOptions()
    const first = duplicateRequest(options, 'billionaire', new Date('2026-10-10T06:00:00.000Z'))
    const second = duplicateRequest(options, 'billionaire', new Date('2026-10-10T06:00:01.000Z'))

    const text = (result: { options: GenerateOptions }): unknown => result.options.messages[0]!.content[0]
    // A fixed prefix would leave two duplicates of the *same* request sharing one
    // cache entry after the first miss; a timestamp cannot.
    expect(text(first)).not.toEqual(text(second))
  })

  it('leaves a request with no system message unstamped rather than minting one', () => {
    const options: GenerateOptions = {
      provider: 'test',
      model: 'test-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }
    const { options: duplicate, prefixed } = duplicateRequest(options, 'billionaire', AT)

    // A system entry must be a durable `Message` with an `id` and a `source`;
    // only `role: 'user'` may be the identity-free `RequestUserInput` this
    // package can invent. Minting a durable identity for a throwaway copy is
    // what this plugin must not do, so the copy stays verbatim instead.
    expect(prefixed).toBe(false)
    expect(duplicate).toBe(options)
  })

  it('leaves the original request frozen, so a later mutation would throw', () => {
    const options = frozenOptions()
    duplicateRequest(options, 'billionaire', AT)

    // Guards the clone: if `duplicateRequest` ever wrote into the caller's
    // array, this is the shape of failure the harness would hit.
    expect(() => { (options.messages as GenerateOptions['messages']).push({ role: 'user', content: [] }) }).toThrow()
    expect(Object.isFrozen(options)).toBe(true)
  })

  it('preserves the system message identity and its non-text blocks', () => {
    const options: GenerateOptions = {
      provider: 'test',
      model: 'test-model',
      messages: [{
        role: 'system',
        // An `id`/`source` and a non-text block are what an in-place stamp must
        // carry over: only the leading text block is rewritten.
        id: 'sys-1',
        source: { kind: 'system-prompt' },
        content: [
          { type: 'text', text: 'system prompt' },
          { type: 'image', handle: 'img-1' },
        ],
      } as never],
    }
    const { options: duplicate } = duplicateRequest(options, 'billionaire', AT)
    const system = duplicate.messages[0] as Record<string, unknown>

    expect(system['id']).toBe('sys-1')
    expect(system['source']).toEqual({ kind: 'system-prompt' })
    expect(system['content']).toEqual([
      { type: 'text', text: billionaireStamp(AT) },
      { type: 'text', text: 'system prompt' },
      { type: 'image', handle: 'img-1' },
    ])
  })

  it('keeps the duplicate\'s routing fields identical, so only the prefix differs', () => {
    const options = frozenOptions()
    const { options: duplicate } = duplicateRequest(options, 'billionaire', AT)

    // Provider, model and sampling must not drift: changing those would alter
    // which adapter (or price) the duplicate lands on, which is a different
    // claim than "the cache missed".
    expect(duplicate.provider).toBe(options.provider)
    expect(duplicate.model).toBe(options.model)
    expect(duplicate.temperature).toBe(options.temperature)
    expect(duplicate.maxTokens).toBe(options.maxTokens)
  })
})