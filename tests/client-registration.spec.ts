/**
 * The browser half's registration handshake.
 *
 * This exists because of a silent failure: the bar was registered into a slot
 * the shell never declares, and `slots.inject` only ever runs its callback for
 * a declared slot. Nothing rendered, nothing threw, and the plugin looked
 * installed-but-dead. These cases pin the two properties that failure violated —
 * the registration actually reaches `slots.register`, and it targets a slot the
 * sidebar really declares.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject, SLOT } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

/**
 * The slot names the shipped `@deepseek-ai/dsh-client-ui-sidebar` bundle
 * declares in its `children` table. Transcribed from `lib/client.js`; the bar
 * targets one of these and nothing else.
 *
 * `sidebar.footer.action` is the one the bar uses, and it is the seat that puts
 * the figures directly above the account button: the sidebar renders it in
 * `footerActions`, which precedes `settingsArea` (the user name) in the foot
 * column.
 */
const DECLARED_BY_SIDEBAR = new Set([
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.footer.action',
  'sidebar.panellist',
  'sidebar.settings',
  'sidebar.workspaces',
])

/** A slots service that records the handshake the way the renderer performs it. */
function fakeSlots(): {
  readonly injected: string[]
  readonly registered: { name: string; locale: string; id?: string; order?: number }[]
  readonly service: import('../src/client/contracts.ts').SlotsService
} {
  const injected: string[] = []
  const registered: { name: string; locale: string; id?: string; order?: number }[] = []
  const declared = DECLARED_BY_SIDEBAR
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
  it('registers into a slot the sidebar actually declares', () => {
    expect(DECLARED_BY_SIDEBAR.has(SLOT)).toBe(true)
  })

  it('targets the foot row that renders above the account button', () => {
    // The seat is load-bearing: `sidebar.settings` holds the account button
    // (avatar and user name), and the sidebar renders `sidebar.footer.action`
    // before it in the foot column. Registering into the wrong one would put
    // the figures somewhere other than above the user name.
    expect(SLOT).toBe('sidebar.footer.action')
    expect(DECLARED_BY_SIDEBAR.has('sidebar.settings')).toBe(true)
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

    // `sidebar.footer.action` is a list slot, so entries are ordered by
    // `order` and deduplicated by `id`. A fresh id adds a cell beside the
    // shipped entries; the shipped occupant is `cordis-panel`.
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