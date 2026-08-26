import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildBridgePrompt,
  createVisionBridgeSendSession,
  type BridgeConversation,
  type BridgeSession,
  type BridgeSubmitOutcome,
  type WebDraftUploadResponse,
  type WebImageRoutingResponse,
} from '../src/client/bridge.js'
import * as ClientPlugin from '../src/client/index.js'
import { BRIDGE_REFERENCE_FIELD } from '../src/client/chat-render.js'
import { WEB_ATTACHMENT_ENDPOINT } from '../src/web-contract.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

const successOutcome = { kind: 'success' } as const satisfies BridgeSubmitOutcome

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const compositionCases = [
  ['dsh-open-file first', 'file-first', successOutcome, true],
  ['dsh-open-eyes first', 'eyes-first', successOutcome, true],
  ['dsh-open-file first with an error outcome', 'file-first', { kind: 'error', text: 'rejected' } as const, false],
  ['dsh-open-eyes first with an error outcome', 'eyes-first', { kind: 'error', text: 'rejected' } as const, false],
] as const

function conversation() {
  const attachment = {
    kind: 'image' as const,
    id: 'draft-1',
    previewUrl: 'blob:test',
    file: new File([png], 'clipboard.png', { type: 'image/png' }),
  }
  const value = {
    sendSession: vi.fn<BridgeConversation['sendSession']>(async () => successOutcome),
    draftImages: vi.fn(() => [attachment]),
    releaseDraftImages: vi.fn(),
    resolveImage: vi.fn<(sessionId: string, attachment: unknown) => Promise<string>>(async () => 'blob:native-image'),
  } satisfies BridgeConversation & {
    resolveImage(sessionId: string, attachment: unknown): Promise<string>
  }
  return { value, attachment }
}

function session(): BridgeSession {
  return { sessionId: 'session-1' }
}

function response(payload: WebDraftUploadResponse | WebImageRoutingResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const bridgeRoute: WebImageRoutingResponse = {
  route: 'bridge',
  configured: true,
  defaultProvider: 'primary',
  providerIds: ['primary'],
}

const nativeRoute: WebImageRoutingResponse = {
  route: 'native',
  configured: true,
  defaultProvider: 'primary',
  providerIds: ['primary'],
}

function connection() {
  return {
    api: {
      sessions: {
        models: vi.fn(async () => ({
          result: {
            ok: true as const,
            value: { current: { provider: 'main-provider', model: 'text-model' } },
          },
        })),
      },
      settings: {
        describe: vi.fn(async () => ({ result: { ok: true as const, value: { namespaces: [] } } })),
        mutate: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      },
      credentials: {
        describe: vi.fn(async () => ({ result: { ok: true as const, value: { credentials: {} } } })),
        set: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
        unset: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      },
    },
  }
}

function slots() {
  const service = {
    register: vi.fn(() => () => undefined),
    entries: vi.fn(() => []),
    inject: vi.fn((_name: string, install: () => unknown) => install()),
  }
  return service
}

function settingsScope() {
  const scope = {
    getSnapshot: vi.fn(() => ({
      status: 'ready' as const,
      value: { profiles: {} },
      base: { profiles: {} },
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    })),
    subscribe: vi.fn(() => () => undefined),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
  }
  return { bind: vi.fn(() => scope), scope }
}

function locale() {
  return {
    register: vi.fn(() => () => undefined),
    bind: vi.fn(() => (key: string) => key),
  }
}

const OPEN_FILE_ADAPTER = Symbol.for('dsh-open-file.rc6.submit-adapter')

/** Mirrors dsh-open-file@0.1.1-rc.2's public adapter and disposer shape. */
function installOpenFileStyleAdapter(conversation: BridgeConversation): () => void {
  const canonical = conversation as BridgeConversation & Record<PropertyKey, unknown>
  const original = conversation.sendSession
  const wrapped: BridgeConversation['sendSession'] = async (activeSession, text, imageIds, mode, signal) => {
    const withFile = `${text}\n\n[Attached file: notes.txt](dsh-file://session-1/file-1)`
    return original.call(conversation, activeSession, withFile, imageIds, mode, signal)
  }
  canonical[OPEN_FILE_ADAPTER] = Object.freeze({ wrapped })
  conversation.sendSession = wrapped
  return () => {
    if (conversation.sendSession === wrapped) conversation.sendSession = original
    delete canonical[OPEN_FILE_ADAPTER]
  }
}

function installEyesClient(conversationService: BridgeConversation): () => void {
  const effects: Array<() => void> = []
  const settings = settingsScope()
  const localeService = locale()
  ClientPlugin.apply({
    get: name => name === 'conversation'
      ? conversationService
      : name === 'connection'
        ? connection()
        : name === 'slots'
          ? slots()
          : name === 'settingsScope'
            ? settings
            : name === 'locale'
              ? localeService
              : undefined,
    effect: execute => {
      effects.push(execute())
      return undefined
    },
  })
  return () => {
    for (const dispose of effects.reverse()) dispose()
  }
}

describe('browser conversation bridge', () => {
  it('installs on the concrete conversation service and restores the original method on unload', () => {
    const fake = conversation()
    const original = fake.value.sendSession
    const slotService = slots()
    const settings = settingsScope()
    const localeService = locale()
    let dispose: (() => void) | undefined
    ClientPlugin.apply({
      get: name => name === 'conversation'
        ? fake.value
        : name === 'connection'
          ? connection()
          : name === 'slots'
            ? slotService
            : name === 'settingsScope'
              ? settings
              : name === 'locale'
                ? localeService
                : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })
    expect(ClientPlugin.inject).toEqual(['conversation', 'connection', 'slots', 'settingsScope', 'locale'])
    expect(settings.bind).toHaveBeenCalledWith({ namespace: 'dsh-open-eyes' })
    expect(localeService.register).toHaveBeenCalledWith('dsh-open-eyes.settings', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    expect(slotService.inject).toHaveBeenCalledWith('settings.plugin.item', expect.any(Function))
    expect(slotService.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.plugin.item', key: 'dsh-open-eyes', locale: 'dsh-open-eyes.settings' }),
      expect.any(Function),
    )
    expect(fake.value.sendSession).not.toBe(original)
    dispose?.()
    expect(fake.value.sendSession).toBe(original)
  })

  it('patches the canonical Cordis service instead of a caller shadow', () => {
    const fake = conversation()
    const original = fake.value.sendSession
    const shadow = new Map<PropertyKey, unknown>()
    const traced = new Proxy(fake.value, {
      get(target, property, receiver) {
        if (property === Symbol.for('cordis.original')) return target
        return shadow.has(property) ? shadow.get(property) : Reflect.get(target, property, receiver)
      },
      set(_target, property, value) {
        shadow.set(property, value)
        return true
      },
    })
    let dispose: (() => void) | undefined
    const settings = settingsScope()
    const localeService = locale()

    ClientPlugin.apply({
      get: name => name === 'conversation'
        ? traced
        : name === 'connection'
          ? connection()
          : name === 'slots'
            ? slots()
            : name === 'settingsScope'
              ? settings
              : name === 'locale'
                ? localeService
                : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })

    expect(fake.value.sendSession).not.toBe(original)
    expect(shadow.has('sendSession')).toBe(false)
    dispose?.()
    expect(fake.value.sendSession).toBe(original)
  })

  it('shadows an inherited method only on the canonical instance', () => {
    const attachment = {
      kind: 'image' as const,
      id: 'draft-1',
      previewUrl: 'blob:test',
      file: new File([png], 'clipboard.png', { type: 'image/png' }),
    }
    class ConversationService implements BridgeConversation {
      async sendSession() { return successOutcome }
      draftImages() { return [attachment] }
      releaseDraftImages(): void {}
      async resolveImage() { return 'blob:native-image' }
    }
    const root = new ConversationService()
    const owner = Object.getPrototypeOf(root) as ConversationService
    const original = owner.sendSession
    const traced = new Proxy(root, {
      get(target, property, receiver) {
        if (property === Symbol.for('cordis.original')) return target
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(receiver) : value
      },
    })
    let dispose: (() => void) | undefined
    const settings = settingsScope()
    const localeService = locale()

    ClientPlugin.apply({
      get: name => name === 'conversation'
        ? traced
        : name === 'connection'
          ? connection()
          : name === 'slots'
            ? slots()
            : name === 'settingsScope'
              ? settings
              : name === 'locale'
                ? localeService
                : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })

    expect(owner.sendSession).toBe(original)
    expect(Object.hasOwn(root, 'sendSession')).toBe(true)
    dispose?.()
    expect(owner.sendSession).toBe(original)
    expect(Object.hasOwn(root, 'sendSession')).toBe(false)
  })

  it('resolves only bridge history images through the plugin and restores the native resolver on unload', async () => {
    const fake = conversation()
    const original = fake.value.resolveImage
    const fetcher = vi.fn<typeof fetch>(async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '4' },
    }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bridge-history')
    const dispose = installEyesClient(fake.value)
    const bridgeAttachment = {
      attachmentId: 'bridge-1',
      mediaType: 'image/png',
      bytes: 4,
      [BRIDGE_REFERENCE_FIELD]: 'vision-bridge://attachment/v1/session-1/bridge-1?media=image%2Fpng&bytes=4&width=1&height=1',
    }

    await expect(fake.value.resolveImage('session-1', bridgeAttachment)).resolves.toBe('blob:bridge-history')
    expect(fetcher).toHaveBeenCalledWith(WEB_ATTACHMENT_ENDPOINT, expect.objectContaining({ method: 'POST' }))
    expect(original).not.toHaveBeenCalled()

    const nativeAttachment = { attachmentId: 'native-1', mediaType: 'image/png' }
    await expect(fake.value.resolveImage('session-1', nativeAttachment)).resolves.toBe('blob:native-image')
    expect(original).toHaveBeenCalledWith('session-1', nativeAttachment)

    dispose()
    expect(fake.value.resolveImage).toBe(original)
  })

  it.each([
    ['dsh-open-file first', 'file-first'],
    ['dsh-open-eyes first', 'eyes-first'],
  ] as const)('installs and unloads with the published dsh-open-file lifecycle: %s', async (_label, order) => {
    const fake = conversation()
    const original = fake.value.sendSession
    let disposeFile: () => void
    let disposeEyes: () => void
    if (order === 'file-first') {
      disposeFile = installOpenFileStyleAdapter(fake.value)
      disposeEyes = installEyesClient(fake.value)
    } else {
      disposeEyes = installEyesClient(fake.value)
      disposeFile = installOpenFileStyleAdapter(fake.value)
    }
    const signal = new AbortController().signal

    const outcome = await fake.value.sendSession(session(), 'Read both.', [], 'queue', signal)

    expect(outcome).toBe(successOutcome)
    expect(original).toHaveBeenCalledWith(
      session(),
      expect.stringContaining('[Attached file: notes.txt]'),
      [],
      'queue',
      signal,
    )
    if (order === 'file-first') {
      disposeEyes()
      disposeFile()
    } else {
      disposeFile()
      disposeEyes()
    }
    expect(fake.value.sendSession).toBe(original)
  })

  it('turns a covered wrapper into an exact pass-through when eyes unloads first', async () => {
    const fake = conversation()
    const original = fake.value.sendSession
    const disposeEyes = installEyesClient(fake.value)
    const disposeFile = installOpenFileStyleAdapter(fake.value)
    const signal = new AbortController().signal
    disposeEyes()

    const outcome = await fake.value.sendSession(session(), 'Read the file.', ['draft-1'], 'steer', signal)

    expect(outcome).toBe(successOutcome)
    expect(original).toHaveBeenCalledWith(
      session(),
      expect.stringContaining('[Attached file: notes.txt]'),
      ['draft-1'],
      'steer',
      signal,
    )
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
    disposeFile()
  })

  it('passes text-only submissions through without reading model capability', async () => {
    const fake = conversation()
    fake.value.sendSession.mockResolvedValueOnce(successOutcome as never)
    const fetcher = vi.fn<typeof fetch>()
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)
    const activeSession = session()
    const signal = new AbortController().signal
    const outcome = await wrapped(activeSession, 'hello', [], 'queue', signal)
    expect(outcome).toBe(successOutcome)
    expect(fetcher).not.toHaveBeenCalled()
    expect(fake.value.sendSession).toHaveBeenCalledWith(activeSession, 'hello', [], 'queue', signal)
  })

  it('routes an enabled session, then sends only user text and attachment links', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    fake.value.sendSession.mockResolvedValueOnce(successOutcome as never)
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)
    const activeSession = session()
    const signal = new AbortController().signal

    const outcome = await wrapped(activeSession, 'Read the exact error code.', ['draft-1'], 'steer', signal)

    expect(outcome).toBe(successOutcome)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/vision-bridge/v1/web-image-route')
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(signal)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      sessionId: 'session-1',
    })
    expect(fetcher.mock.calls[1]?.[0]).toBe('/vision-bridge/v1/web-drafts')
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(signal)
    const uploadBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(uploadBody).toEqual({
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: Buffer.from(png).toString('base64') }],
    })
    expect(fake.value.sendSession).toHaveBeenCalledWith(
      activeSession,
      `Read the exact error code.\n\n[Attached image 1](${reference})`,
      [],
      'steer',
      signal,
    )
    const forwarded = fake.value.sendSession.mock.calls[0]![1]
    expect(forwarded).not.toContain('handoff')
    expect(forwarded).not.toContain('call vision_analyze')
    expect(forwarded).not.toContain('default provider')
    expect(forwarded).not.toContain('third-party vision provider')
    expect(fake.value.releaseDraftImages).toHaveBeenCalledWith([fake.attachment])
  })

  it('adds no text on the user\'s behalf for image-only input', () => {
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const prompt = buildBridgePrompt('', {
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
      references: [reference],
    })
    expect(prompt).toBe(`[Attached image 1](${reference})`)
  })

  it('preserves the user\'s existing text exactly before attachment links', () => {
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const original = '  Read this exact text.\n'
    const prompt = buildBridgePrompt(original, {
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
      references: [reference],
    })
    expect(prompt).toBe(`${original}\n\n[Attached image 1](${reference})`)
  })

  it('keeps a disabled session entirely on the official conversation path', async () => {
    const fake = conversation()
    fake.value.sendSession.mockResolvedValueOnce(successOutcome as never)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(nativeRoute))
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)
    const activeSession = session()
    const signal = new AbortController().signal

    const outcome = await wrapped(activeSession, 'Inspect this UI.', ['draft-1'], 'queue', signal)

    expect(outcome).toBe(successOutcome)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(signal)
    expect(fake.value.draftImages).not.toHaveBeenCalled()
    expect(fake.value.sendSession).toHaveBeenCalledWith(activeSession, 'Inspect this UI.', ['draft-1'], 'queue', signal)
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it('returns an error outcome unchanged and preserves bridge draft images', async () => {
    const fake = conversation()
    const errorOutcome = { kind: 'error', text: 'submission rejected' } as const
    fake.value.sendSession.mockResolvedValueOnce(errorOutcome as never)
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)

    const outcome = await wrapped(session(), 'Read this.', ['draft-1'], 'queue', new AbortController().signal)

    expect(outcome).toBe(errorOutcome)
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it('preserves the original rejection and bridge draft images', async () => {
    const fake = conversation()
    const failure = new Error('original submission failed')
    fake.value.sendSession.mockRejectedValueOnce(failure)
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)

    await expect(wrapped(session(), 'Read this.', ['draft-1'], 'queue')).rejects.toBe(failure)
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it.each(compositionCases)('composes with a contract-preserving file adapter: %s', async (_label, order, expected, releases) => {
    const fake = conversation()
    const original = fake.value.sendSession
    const layered: BridgeConversation = fake.value
    original.mockResolvedValueOnce(expected as never)
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    if (order === 'file-first') {
      installOpenFileStyleAdapter(layered)
      layered.sendSession = createVisionBridgeSendSession(layered, fetcher)
    } else {
      layered.sendSession = createVisionBridgeSendSession(layered, fetcher)
      installOpenFileStyleAdapter(layered)
    }
    const signal = new AbortController().signal

    const outcome = await layered.sendSession(session(), 'Read both.', ['draft-1'], 'queue', signal)

    expect(outcome).toBe(expected)
    expect(original.mock.calls[0]?.[4]).toBe(signal)
    expect(fake.value.releaseDraftImages).toHaveBeenCalledTimes(releases ? 1 : 0)
  })

  it('rechecks the Host session latch on every image send without inspecting model modality', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
      .mockResolvedValueOnce(response(nativeRoute))
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'first', ['draft-1'], 'queue')
    await wrapped(activeSession, 'second', ['draft-1'], 'queue')

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fake.value.sendSession.mock.calls[0]?.[1]).toContain('[Attached image 1]')
    expect(fake.value.sendSession.mock.calls[0]?.[2]).toEqual([])
    expect(fake.value.sendSession.mock.calls[1]).toEqual([activeSession, 'second', ['draft-1'], 'queue', undefined])
  })

  it('supports repeated bridge sends in the same non-blank session without shared state', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
    for (let index = 0; index < 2; index += 1) {
      fetcher.mockResolvedValueOnce(response(bridgeRoute))
      fetcher.mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    }
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'first question', ['draft-1'], 'queue')
    await wrapped(activeSession, 'follow-up question', ['draft-1'], 'queue')

    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fake.value.sendSession).toHaveBeenCalledTimes(2)
    expect(fake.value.sendSession.mock.calls[1]?.[1]).toBe(`follow-up question\n\n[Attached image 1](${reference})`)
    expect(fake.value.releaseDraftImages).toHaveBeenCalledTimes(2)
  })

  it('preserves drafts and sends no prompt when the bridge is unconfigured', async () => {
    const fake = conversation()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      route: 'bridge',
      configured: false,
      defaultProvider: null,
      providerIds: [],
    }))
    const wrapped = createVisionBridgeSendSession(fake.value, fetcher)

    await expect(wrapped(session(), 'Read this.', ['draft-1'], 'queue')).rejects.toThrow('not configured')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fake.value.sendSession).not.toHaveBeenCalled()
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it('preserves drafts and sends no prompt when routing or upload fails', async () => {
    const routingFailure = conversation()
    const routingFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }))
    await expect(createVisionBridgeSendSession(routingFailure.value, routingFetcher)(
      session(), 'x', ['draft-1'], 'queue',
    )).rejects.toThrow('enablement state')
    expect(routingFailure.value.sendSession).not.toHaveBeenCalled()
    expect(routingFailure.value.releaseDraftImages).not.toHaveBeenCalled()

    const uploadFailure = conversation()
    const uploadFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(new Response('{"error":"rejected"}', { status: 413 }))
    await expect(createVisionBridgeSendSession(uploadFailure.value, uploadFetcher)(
      session(), 'x', ['draft-1'], 'queue',
    )).rejects.toThrow('could not accept')
    expect(uploadFailure.value.sendSession).not.toHaveBeenCalled()
    expect(uploadFailure.value.releaseDraftImages).not.toHaveBeenCalled()
  })
})
