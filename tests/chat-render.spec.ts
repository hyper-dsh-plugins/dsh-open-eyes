import { describe, expect, it, vi } from 'vitest'
import { isValidElement, memo } from 'react'
import { ATTACHMENT_LINK_LABEL, BRIDGE_REFERENCE_FIELD, projectBridgeContent } from '../src/client/chat-render.js'
import type { ChatContentBlock } from '../src/client/chat-render.js'
import { apply as asyncApply } from '../src/client/index.js'

function bridgeLink(index: number, attachmentId = `att-${index}`): string {
  return `[${ATTACHMENT_LINK_LABEL} ${index}](vision-bridge://attachment/v1/session-1/${attachmentId}?media=image%2Fpng&bytes=1200&width=60&height=40)`
}

function text(text: string): ChatContentBlock {
  return { type: 'text', text }
}

describe('projectBridgeContent', () => {
  it('leaves ordinary user text completely untouched', () => {
    const content = [text('What is in this chart?')]
    const result = projectBridgeContent(content)
    expect(result.bridged).toBe(false)
    expect(result.content).toBe(content)
    expect(result.question).toBe('What is in this chart?')
  })

  it('leaves non-text blocks untouched when no bridge links exist', () => {
    const image = { type: 'image', attachment: { attachmentId: 'native-1' } }
    const content = [text('native turn'), image as ChatContentBlock]
    const result = projectBridgeContent(content)
    expect(result.bridged).toBe(false)
    expect(result.content).toBe(content)
  })

  it('projects a bridged turn into question text plus image blocks', () => {
    const result = projectBridgeContent([
      text(`Read the error code.\n\n${bridgeLink(1)}\n${bridgeLink(2)}`),
    ])
    expect(result.bridged).toBe(true)
    expect(result.question).toBe('Read the error code.')
    const images = result.content.filter((block) => block.type === 'image')
    expect(images).toHaveLength(2)
    expect(images[0]).toEqual({
      type: 'image',
      attachment: {
        attachmentId: 'att-1',
        mediaType: 'image/png',
        [BRIDGE_REFERENCE_FIELD]: 'vision-bridge://attachment/v1/session-1/att-1?media=image%2Fpng&bytes=1200&width=60&height=40',
        bytes: 1200,
        width: 60,
        height: 40,
      },
    })
    expect(result.content.find((block) => block.type === 'text')).toEqual({
      type: 'text',
      text: 'Read the error code.',
    })
  })

  it('keeps the question when it mixes plain text around links', () => {
    const result = projectBridgeContent([
      text(`Before ${bridgeLink(1)} after`),
    ])
    expect(result.question).toBe('Before  after')
  })

  it('removes only the bridge separator and preserves the user text exactly', () => {
    const original = '  Keep my spacing.\n'
    const result = projectBridgeContent([text(`${original}\n\n${bridgeLink(1)}`)])
    expect(result.question).toBe(original)
    expect(result.content.find((block) => block.type === 'text')).toEqual({ type: 'text', text: original })
  })

  it('renders a links-only turn as image blocks without an empty bubble text', () => {
    const result = projectBridgeContent([text(`${bridgeLink(1)}`)])
    expect(result.bridged).toBe(true)
    expect(result.question).toBe('')
    expect(result.content.filter((block) => block.type === 'text')).toHaveLength(0)
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(1)
  })

  it('never matches similar-looking links that are not bridge tokens', () => {
    const content = [
      text('[Attached image 1](https://example.test/a.png)'),
      text('[Attached image 2](vision-bridge://other/v1/x)'),
      text('Attached image 3'),
    ]
    const result = projectBridgeContent(content)
    expect(result.bridged).toBe(false)
    expect(result.content).toBe(content)
  })

  it('survives a malformed bridge token by rendering a null attachment block', () => {
    const result = projectBridgeContent([
      text(`[Attached image 1](vision-bridge://attachment/v1/session-1/not-a-valid-%E2%80-ref)`),
    ])
    expect(result.bridged).toBe(true)
    const image = result.content.find((block) => block.type === 'image')
    expect(image).toEqual({ type: 'image', attachment: null })
  })
})

describe('chat node slot registration', () => {
  const apply = asyncApply

  function slotsService(stockFor: Record<string, (props: never) => unknown>) {
    const registrations: { name: string; key: string; priority: number; locale?: string; dispose: () => void }[] = []
    const entries: { component: (props: never) => unknown; options: { key?: string; priority?: number | undefined } }[] =
      Object.entries(stockFor).map(([key, component]) => ({
        component,
        options: { key },
      }))
    return {
      value: {
        register: vi.fn((options: { name: string; key: string; priority?: number; locale?: string }, component: (props: never) => unknown) => {
          const record = {
            name: options.name,
            key: options.key,
            priority: options.priority ?? 0,
            ...(options.locale === undefined ? {} : { locale: options.locale }),
            dispose: () => {},
          }
          registrations.push(record)
          entries.push({
            component,
            options: options.priority === undefined ? { key: options.key } : { key: options.key, priority: options.priority },
          })
          return () => {
            const index = entries.findIndex((entry) => entry.component === component)
            if (index >= 0) entries.splice(index, 1)
          }
        }),
        entries: vi.fn((name: string) => (name === 'conversation.chat.node' ? [...entries] : [])),
        inject: vi.fn((_name: string, install: () => unknown) => install()),
      },
      registrations,
    }
  }

  function conversation() {
    const attachment = {
      kind: 'image' as const,
      id: 'draft-1',
      previewUrl: 'blob:test',
      file: new File([Uint8Array.from([1])], 'a.png', { type: 'image/png' }),
    }
    return {
      sendSession: vi.fn(async () => undefined),
      draftImages: vi.fn(() => [attachment]),
      releaseDraftImages: vi.fn(),
      resolveImage: vi.fn(async () => 'blob:native-image'),
    }
  }

  function remote() {
    return {
      settings: {
        describe: vi.fn(async () => ({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        mutate: vi.fn(async () => ({ ok: true as const, value: {} })),
      },
      credentials: {
        describe: vi.fn(async () => ({ ok: true as const, value: {} })),
        set: vi.fn(async () => ({ ok: true as const, value: {} })),
        unset: vi.fn(async () => ({ ok: true as const, value: {} })),
      },
    }
  }

  function context(services: Record<string, unknown>) {
    const disposers: (() => void)[] = []
    const scope = {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: { profiles: {} },
        base: { profiles: {} },
        user: undefined,
        revision: 1,
        writable: true,
        mode: 'host' as const,
      }),
      subscribe: () => () => undefined,
      set: async () => undefined,
      unset: async () => undefined,
    }
    const defaults = {
      settingsScope: { bind: () => scope },
      locale: {
        register: () => () => undefined,
        bind: () => (key: string) => key,
      },
    }
    return {
      value: {
        get: (name: string) => services[name] ?? defaults[name as keyof typeof defaults],
        effect: (execute: () => (() => void)) => {
          disposers.push(execute())
          return undefined
        },
      },
      dispose: () => {
        for (const dispose of disposers.reverse()) dispose()
        disposers.length = 0
      },
    }
  }

  it('registers user and steering cells below stock priority and disposes them', () => {
    const stock = vi.fn(() => 'stock')
    const slots = slotsService({ user: stock as (props: never) => unknown })
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const chatRegistrations = slots.registrations.filter(record => record.name === 'conversation.chat.node')
    expect(chatRegistrations).toHaveLength(2)
    expect(chatRegistrations.map((r) => r.key).sort()).toEqual(['steering', 'user'])
    expect(chatRegistrations.every((r) => r.priority < 0)).toBe(true)
    expect(chatRegistrations.every((r) => r.locale === 'chat')).toBe(true)
    const before = slots.value.entries('conversation.chat.node').length
    ctx.dispose()
    expect(slots.value.entries('conversation.chat.node')).toHaveLength(before - 2)
    expect(slots.value.entries('conversation.chat.node').every((entry) => entry.component !== undefined)).toBe(true)
  })

  it('delegates ordinary messages to the stock renderer with identical props', () => {
    const stock = vi.fn(() => null)
    const slots = slotsService({ user: stock as (props: never) => unknown })
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const bridge = slots.value
      .entries('conversation.chat.node')
      .find((entry) => entry.options.key === 'user' && (entry.options.priority ?? 0) !== 0)
    const props = {
      node: { kind: 'user', data: { content: [text('plain question')] } },
      t: (k: string) => k,
      loadImage: vi.fn(async () => 'blob:thumb'),
    }
    const result = (bridge!.component as unknown as (p: unknown) => unknown)(props)
    expect(isValidElement(result)).toBe(true)
    expect((result as { type: unknown }).type).toBe(stock)
    expect((result as { props: unknown }).props).toEqual(props)
    expect(stock).not.toHaveBeenCalled()
    ctx.dispose()
  })

  it('forwards the stock renderer props while projecting a bridged message', () => {
    const stock = vi.fn(() => null)
    const slots = slotsService({ user: stock as (props: never) => unknown })
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const bridge = slots.value
      .entries('conversation.chat.node')
      .find((entry) => entry.options.key === 'user' && (entry.options.priority ?? 0) !== 0)
    const t = (k: string) => k
    const loadImage = vi.fn(async () => 'blob:thumb')
    const result = (bridge!.component as unknown as (p: unknown) => unknown)({
      node: { kind: 'user', data: { content: [text(`Question\n\n${bridgeLink(1)}`)] } },
      t,
      loadImage,
    })
    const forwarded = (result as { props: { t: unknown; loadImage: unknown; node: { kind: string } } }).props
    expect(forwarded.t).toBe(t)
    expect(forwarded.loadImage).toBe(loadImage)
    expect(forwarded.node.kind).toBe('user')
    expect(stock).not.toHaveBeenCalled()
    ctx.dispose()
  })

  it('hands the stock renderer upgraded content for a bridged message', () => {
    const stock = vi.fn(() => null)
    const slots = slotsService({ user: stock as (props: never) => unknown })
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const bridge = slots.value
      .entries('conversation.chat.node')
      .find((entry) => entry.options.key === 'user' && (entry.options.priority ?? 0) !== 0)
    const originalNode = {
      kind: 'user',
      data: { content: [text(`Question\n\n${bridgeLink(1)}`)], seq: 3, time: 42 },
    }
    const result = (bridge!.component as unknown as (p: unknown) => unknown)({ node: originalNode })
    const call = (result as { props: { node: typeof originalNode } }).props
    expect(call.node.data.content).toEqual([
      { type: 'text', text: 'Question' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-1',
          mediaType: 'image/png',
          [BRIDGE_REFERENCE_FIELD]: 'vision-bridge://attachment/v1/session-1/att-1?media=image%2Fpng&bytes=1200&width=60&height=40',
          bytes: 1200,
          width: 60,
          height: 40,
        },
      },
    ])
    // The durable node itself is never mutated.
    expect(originalNode.data.content[0]).toEqual({ type: 'text', text: `Question\n\n${bridgeLink(1)}` })
    expect(stock).not.toHaveBeenCalled()
    ctx.dispose()
  })

  it('mounts the official memo-shaped renderer instead of invoking it as a function', () => {
    const inner = vi.fn(() => null)
    const stock = memo(inner)
    const slots = slotsService({ user: stock as unknown as (props: never) => unknown })
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const bridge = slots.value
      .entries('conversation.chat.node')
      .find((entry) => entry.options.key === 'user' && (entry.options.priority ?? 0) !== 0)
    const result = (bridge!.component as unknown as (p: unknown) => unknown)({
      node: { kind: 'user', data: { content: [text(`Question\n\n${bridgeLink(1)}`)] } },
    })
    expect(isValidElement(result)).toBe(true)
    expect((result as { type: unknown }).type).toBe(stock)
    expect(inner).not.toHaveBeenCalled()
    ctx.dispose()
  })

  it('renders nothing when no stock renderer is available for a bridged message', () => {
    const slots = slotsService({})
    const ctx = context({ conversation: conversation(), remote: remote(), slots: slots.value })
    apply(ctx.value)
    const bridge = slots.value
      .entries('conversation.chat.node')
      .find((entry) => entry.options.key === 'user')
    const result = (bridge!.component as unknown as (p: unknown) => unknown)({
      node: { kind: 'user', data: { content: [text(`Q\n\n${bridgeLink(1)}`)] } },
    })
    expect(result).toBeNull()
    ctx.dispose()
  })

  it('still patches and restores sendSession alongside the presentation layer', () => {
    const fake = conversation()
    const original = fake.sendSession
    const slots = slotsService({ user: vi.fn() })
    const ctx = context({ conversation: fake, remote: remote(), slots: slots.value })
    apply(ctx.value)
    expect(fake.sendSession).not.toBe(original)
    ctx.dispose()
    expect(fake.sendSession).toBe(original)
  })

  it('requires the slots service at install time', () => {
    const ctx = context({ conversation: conversation(), remote: remote() })
    expect(() => apply(ctx.value)).toThrow(/slots service/)
  })
})
