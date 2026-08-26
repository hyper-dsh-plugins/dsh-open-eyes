import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Config, validateConfig } from '../src/config.js'
import {
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
  WEB_PROVIDER_VALIDATION_ENDPOINT,
  createWebAttachmentHandler,
  createWebDraftHandler,
  createWebImageRouteHandler,
  createWebProviderValidationHandler,
  decodeWebAttachmentReference,
} from '../src/web-draft.js'
import * as webDraftModule from '../src/web-draft.js'

const png = readFileSync(new URL('../fixtures/tiny.png', import.meta.url))
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  }))
})

function resolved(configured = true) {
  return validateConfig(Config(configured
    ? {
        providers: [{
          id: 'primary',
          protocol: 'openai-responses',
          baseUrl: 'https://vision.example.test/v1',
          model: 'vision-model',
          credential: 'VISION_API_KEY',
        }],
      }
    : {}))
}

async function serve(handler: ReturnType<typeof createWebDraftHandler>): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  return `http://127.0.0.1:${address.port}`
}

function attachmentRef(index = 0): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${String(index).padStart(64, 'a')}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: png.byteLength,
    width: 1,
    height: 1,
    name: 'clipboard.png',
  }
}

function fakeAttachments() {
  const validateImage = vi.fn(async () => undefined)
  const saveImage = vi.fn(async () => attachmentRef())
  const readImage = vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: new Uint8Array(png) }))
  return { validateImage, saveImage, readImage }
}

async function post(
  origin: string,
  body: unknown,
  headers: Record<string, string> = {},
  endpoint = WEB_DRAFT_ENDPOINT,
) {
  return fetch(`${origin}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'error',
  })
}

describe('WebUI pasted-image draft admission', () => {
  it('accepts browser-safe discovery metadata while rejecting secret fields', async () => {
    const createHandler = (webDraftModule as typeof webDraftModule & {
      createWebProviderModelsHandler?: (options: {
        readonly models: (draft: {
          readonly providerId: string
          readonly protocol: string
          readonly baseUrl: string
          readonly credential?: string
        }, signal: AbortSignal) => Promise<readonly string[]>
      }) => ReturnType<typeof createWebDraftHandler>
    }).createWebProviderModelsHandler
    expect(createHandler).toBeTypeOf('function')
    if (createHandler === undefined) return
    const models = vi.fn(async () => ['vision-b', 'vision-a'])
    const origin = await serve(createHandler({ models }))

    const draft = {
      providerId: 'primary',
      protocol: 'openai-responses',
      baseUrl: 'https://vision.example.test/v1',
      credential: 'DSH_OPEN_EYES_P7072696D617279_R6D6F64656C2D646973636F766572792D6C6F6F6B75702D31_API_KEY',
    }
    const response = await post(origin, draft, {}, '/vision-bridge/v1/provider-models')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, models: ['vision-b', 'vision-a'] })
    expect(models).toHaveBeenCalledWith(draft, expect.any(AbortSignal))

    const rejected = await post(origin, {
      providerId: 'primary',
      apiKey: 'must-not-enter-model-discovery',
    }, {}, '/vision-bridge/v1/provider-models')
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ error: 'VISION_WEB_INVALID_PROVIDER_MODELS' })
    expect(models).toHaveBeenCalledOnce()
  })

  it('validates one saved provider id without accepting credentials in the request', async () => {
    const validate = vi.fn(async () => undefined)
    const origin = await serve(createWebProviderValidationHandler({ validate }))

    const success = await post(origin, { providerId: 'primary' }, {}, WEB_PROVIDER_VALIDATION_ENDPOINT)
    expect(success.status).toBe(200)
    expect(await success.json()).toEqual({ ok: true })
    expect(validate).toHaveBeenCalledWith('primary', expect.any(AbortSignal))

    const rejected = await post(origin, {
      providerId: 'primary',
      apiKey: 'must-not-enter-this-route',
    }, {}, WEB_PROVIDER_VALIDATION_ENDPOINT)
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ error: 'VISION_WEB_INVALID_PROVIDER_VALIDATION' })
    expect(validate).toHaveBeenCalledOnce()
  })

  it('returns a safe HTTP diagnostic without reflecting upstream response text', async () => {
    const origin = await serve(createWebProviderValidationHandler({
      validate: async () => {
        throw Object.assign(new Error('vision provider returned HTTP 404: upstream echoed secret-value'), {
          code: 'VISION_UPSTREAM_HTTP',
        })
      },
    }))

    const response = await post(origin, { providerId: 'primary' }, {}, WEB_PROVIDER_VALIDATION_ENDPOINT)
    expect(response.status).toBe(502)
    const responseText = await response.text()
    expect(JSON.parse(responseText)).toEqual({
      ok: false,
      error: 'VISION_UPSTREAM_HTTP',
      diagnostic: { reason: 'http', httpStatus: 404 },
    })
    expect(responseText).not.toContain('secret-value')
  })

  it.each([
    ['vision provider network request failed', 'network'],
    ['vision provider returned a non-JSON response', 'invalid-json'],
    ['OpenAI Responses returned no text output', 'invalid-response'],
  ] as const)('classifies a safe upstream protocol diagnostic for %s', async (message, reason) => {
    const origin = await serve(createWebProviderValidationHandler({
      validate: async () => {
        throw Object.assign(new Error(message), { code: 'VISION_UPSTREAM_PROTOCOL' })
      },
    }))

    const response = await post(origin, { providerId: 'primary' }, {}, WEB_PROVIDER_VALIDATION_ENDPOINT)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'VISION_UPSTREAM_PROTOCOL',
      diagnostic: { reason },
    })
  })

  it('serves a bridge thumbnail only when the exact token is in its direct user session log', async () => {
    const attachments = fakeAttachments()
    const { name: _name, ...stableRef } = attachmentRef()
    const reference = `vision-bridge://attachment/v1/session-1/${encodeURIComponent(String(stableRef.attachmentId))}?media=image%2Fpng&bytes=${stableRef.bytes}&width=1&height=1`
    const session = {
      events: [{
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: `Inspect this.\n\n[Attached image 1](${reference})` }],
        },
      }],
    }
    const origin = await serve(createWebAttachmentHandler({
      attachments,
      session: id => id === 'session-1' ? session : undefined,
    }))

    const response = await post(origin, { reference }, {}, WEB_ATTACHMENT_ENDPOINT)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(png))
    expect(attachments.readImage).toHaveBeenCalledWith(stableRef)
  })

  it('rejects a stored image that is not referenced by the owning direct user turn', async () => {
    const attachments = fakeAttachments()
    const { name: _name, ...stableRef } = attachmentRef()
    const reference = `vision-bridge://attachment/v1/session-1/${encodeURIComponent(String(stableRef.attachmentId))}?media=image%2Fpng&bytes=${stableRef.bytes}&width=1&height=1`
    const origin = await serve(createWebAttachmentHandler({
      attachments,
      session: () => ({ events: [] }),
    }))
    const response = await post(origin, { reference }, {}, WEB_ATTACHMENT_ENDPOINT)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'VISION_WEB_ATTACHMENT_NOT_REFERENCED' })
    expect(attachments.readImage).not.toHaveBeenCalled()
  })

  it('routes every image through the bridge when the session latched enabled', async () => {
    const origin = await serve(createWebImageRouteHandler({
      isEnabled: id => id === 'session-1' ? true : undefined,
      config: resolved(),
    }))
    const response = await post(origin, {
      sessionId: 'session-1',
    }, {}, WEB_IMAGE_ROUTE_ENDPOINT)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      route: 'bridge',
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
    })
  })

  it('routes a disabled session through native DSH without inspecting the main model', async () => {
    const origin = await serve(createWebImageRouteHandler({
      isEnabled: () => false,
      config: resolved(false),
    }))
    const body = { sessionId: 'session-1' }

    const response = await post(origin, body, {}, WEB_IMAGE_ROUTE_ENDPOINT)

    expect((await response.json() as { route: string }).route).toBe('native')
  })

  it('rejects unknown sessions', async () => {
    const unknownSession = await serve(createWebImageRouteHandler({
      isEnabled: () => undefined,
      config: resolved(),
    }))
    const body = { sessionId: 'missing' }
    expect((await post(unknownSession, body, {}, WEB_IMAGE_ROUTE_ENDPOINT)).status).toBe(404)
  })

  it('validates then durably saves a same-origin image and returns a session-bound reference', async () => {
    const attachments = fakeAttachments()
    const handler = createWebDraftHandler({
      attachments,
      hasSession: id => id === 'session-1',
      config: resolved(),
    })
    const origin = await serve(handler)
    const response = await post(origin, {
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: png.toString('base64') }],
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json() as {
      configured: boolean
      defaultProvider: string | null
      providerIds: string[]
      references: string[]
    }
    expect(payload).toMatchObject({
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
    })
    expect(payload.references).toHaveLength(1)
    const { name: _name, ...stableRef } = attachmentRef()
    expect(decodeWebAttachmentReference(payload.references[0]!, 'session-1')).toEqual(stableRef)
    expect(attachments.validateImage).toHaveBeenCalledWith({
      data: new Uint8Array(png),
      mediaType: 'image/png',
      name: 'clipboard.png',
    })
    expect(attachments.saveImage).toHaveBeenCalledAfter(attachments.validateImage)
  })

  it('reports installed-but-unconfigured without persisting the browser draft', async () => {
    const attachments = fakeAttachments()
    const origin = await serve(createWebDraftHandler({
      attachments,
      hasSession: () => true,
      config: resolved(false),
    }))
    const response = await post(origin, {
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: png.toString('base64') }],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      configured: false,
      defaultProvider: null,
      providerIds: [],
      references: [],
    })
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('rejects cross-origin, unknown-session, malformed base64, MIME spoofing, and oversized input', async () => {
    const attachments = fakeAttachments()
    const config = { ...resolved(), maxImageBytes: png.byteLength - 1 }
    const origin = await serve(createWebDraftHandler({ attachments, hasSession: () => false, config }))
    const validBody = {
      sessionId: 'missing',
      images: [{ name: '../private.png', mediaType: 'image/png', data: png.toString('base64') }],
    }

    expect((await post(origin, validBody, { origin: 'https://attacker.example' })).status).toBe(403)
    expect((await post(origin, validBody)).status).toBe(404)

    const knownOrigin = await serve(createWebDraftHandler({ attachments, hasSession: () => true, config: resolved() }))
    expect((await post(knownOrigin, {
      sessionId: 'session-1',
      images: [{ name: 'x.png', mediaType: 'image/png', data: 'not-base64!' }],
    })).status).toBe(400)
    expect((await post(knownOrigin, {
      sessionId: 'session-1',
      images: [{ name: 'x.jpg', mediaType: 'image/jpeg', data: png.toString('base64') }],
    })).status).toBe(415)

    const smallOrigin = await serve(createWebDraftHandler({ attachments, hasSession: () => true, config }))
    expect((await post(smallOrigin, validBody)).status).toBe(413)
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('rejects non-POST and non-JSON requests without enabling CORS', async () => {
    const origin = await serve(createWebDraftHandler({
      attachments: fakeAttachments(),
      hasSession: () => true,
      config: resolved(),
    }))
    const get = await fetch(`${origin}${WEB_DRAFT_ENDPOINT}`)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const text = await fetch(`${origin}${WEB_DRAFT_ENDPOINT}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: 'x',
    })
    expect(text.status).toBe(415)
    expect(text.headers.get('access-control-allow-origin')).toBeNull()
  })
})
