/**
 * The browser half's registration handshake.
 *
 * This exists because of a silent failure: the bar was registered into a slot
 * the shell never declares, and `slots.inject` only ever runs its callback for
 * a declared slot. Nothing rendered, nothing threw, and the plugin looked
 * installed-but-dead. These cases pin the two properties that failure violated —
 * the registration actually reaches `slots.register`, and it targets a slot the
 * conversation surface really declares.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject, SLOT } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

/**
 * The slot names the shipped `@deepseek-ai/dsh-client-ui-conversation` bundle
 * declares in its `children` table. Transcribed from
 * `lib/client.js`; the bar targets one of these and nothing else.
 */
const DECLARED_BY_CONVERSATION = new Set([
  'conversation.composer',
  'conversation.composer.bar',
  'conversation.composer.dock',
  'conversation.header',
  'conversation.input.dock',
  'conversation.input.overlay',
])

/** A slots service that records the handshake the way the renderer performs it. */
function fakeSlots(): {
  readonly injected: string[]
  readonly registered: { name: string; locale: string; id?: string; order?: number }[]
  readonly service: import('../src/client/contracts.ts').SlotsService
} {
  const injected: string[] = []
  const registered: { name: string; locale: string; id?: string; order?: number }[] = []
  const declared = DECLARED_BY_CONVERSATION
  return {
    injected,
    registered,
    service: {
      inject(name, contribute) {
        injected.push(name)
        // The renderer runs `contribute` only once the slot is declared.
        if (declared.has(name)) contribute()
        return () => {}
      },
      register(options) {
        registered.push(options as never)
        return () => {}
      },
    },
  }
}

/** Run the browser half against recording fakes. */
function mount(): {
  readonly injected: string[]
  readonly registered: { name: string; locale: string; id?: string; order?: number }[]
  readonly dictionaries: { namespace: string; zh: unknown; en: unknown }[]
} {
  const slots = fakeSlots()
  const dictionaries: { namespace: string; zh: unknown; en: unknown }[] = []
  apply({
    slots: slots.service,
    locale: {
      register(namespace, dicts) {
        dictionaries.push({ namespace, zh: dicts.zh, en: dicts.en })
        return () => {}
      },
    },
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
  })
  return { injected: slots.injected, registered: slots.registered, dictionaries }
}

describe('client half registration', () => {
  it('registers into a slot the conversation surface actually declares', () => {
    expect(DECLARED_BY_CONVERSATION.has(SLOT)).toBe(true)
  })

  it('reaches slots.register through the inject handshake', () => {
    const { injected, registered } = mount()

    expect(injected).toEqual([SLOT])
    // The guard that makes the old bug possible: an undeclared slot would leave
    // this empty while `injected` still looked healthy.
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe(SLOT)
  })

  it('registers a list entry with a stable id and order', () => {
    const { registered } = mount()

    // `conversation.composer.dock` is a list slot, so entries are ordered by
    // `order` and deduplicated by `id`.
    expect(registered[0]?.id).toBe('i-am-rich')
    expect(typeof registered[0]?.order).toBe('number')
  })

  it('binds the bar to this plugin locale namespace', () => {
    const { registered, dictionaries } = mount()

    expect(registered[0]?.locale).toBe('iAmRich')
    expect(dictionaries).toHaveLength(1)
    expect(dictionaries[0]?.namespace).toBe('iAmRich')
    expect(dictionaries[0]?.zh).toBe(zh)
    expect(dictionaries[0]?.en).toBe(en)
  })

  it('declares the services it needs', () => {
    expect([...inject].sort()).toEqual(['locale', 'slots'])
  })

  it('does not lose the registration when the slot is declared late', () => {
    // The shell may declare the slot after this bundle applies; the handshake
    // must still end in exactly one registration, not zero.
    const registered: { name: string }[] = []
    let onDeclare: (() => void) | undefined
    apply({
      slots: {
        inject(_name, contribute) {
          onDeclare = () => contribute()
          return () => {}
        },
        register(options) {
          registered.push(options as never)
          return () => {}
        },
      },
      locale: { register: () => () => {} },
      effect: (callback: () => unknown) => {
        callback()
        return () => {}
      },
    })

    expect(registered).toHaveLength(0)
    expect(onDeclare).toBeTypeOf('function')
    onDeclare?.()
    expect(registered).toHaveLength(1)
  })
})