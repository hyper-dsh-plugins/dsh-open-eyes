import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import * as httpTransport from '../src/http.js'
import { VisionBridgeError } from '../src/errors.js'

const { getJson, postJson } = httpTransport

const servers: MockServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function server(handler: Parameters<typeof startServer>[0]) {
  const value = await startServer(handler)
  servers.push(value)
  return value
}

function options(url: string, overrides: Record<string, unknown> = {}) {
  return {
    url,
    headers: { 'x-test': 'yes' },
    body: { hello: 'world' },
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    maxResponseBytes: 1_024,
    maxRetries: 0,
    maxRetryDelayMs: 50,
    secrets: [] as string[],
    ...overrides,
  }
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise
    return undefined
  } catch (error) {
    return (error as VisionBridgeError).code
  }
}

describe('bounded HTTP JSON transport', () => {
  it('gets JSON without a request body or synthetic content type', async () => {
    const getJson = (httpTransport as typeof httpTransport & {
      getJson?: (request: Omit<ReturnType<typeof options>, 'body'>) => ReturnType<typeof postJson>
    }).getJson
    expect(getJson).toBeTypeOf('function')
    if (getJson === undefined) return
    const mock = await server((_request, response) => json(response, 200, { data: [{ id: 'vision-model' }] }))

    const { body: _body, ...request } = options(`${mock.origin}/models`)
    await expect(getJson(request)).resolves.toMatchObject({ payload: { data: [{ id: 'vision-model' }] } })
    expect(mock.requests[0]).toMatchObject({ method: 'GET', url: '/models', body: undefined })
    expect(mock.requests[0]?.headers['content-type']).toBeUndefined()
  })

  it('posts JSON without following redirects and returns response headers', async () => {
    const mock = await server((_request, response) => json(response, 200, { ok: true }, { 'x-request-id': 'request-1' }))
    const result = await postJson(options(`${mock.origin}/analyze`))
    expect(result.payload).toEqual({ ok: true })
    expect(result.headers.get('x-request-id')).toBe('request-1')
    expect(mock.requests[0]).toMatchObject({ method: 'POST', url: '/analyze', body: { hello: 'world' } })
    expect(mock.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('rejects redirects so authentication cannot follow them', async () => {
    const target = await server((_request, response) => json(response, 200, { shouldNotReach: true }))
    const source = await server((_request, response) => {
      response.writeHead(307, { location: `${target.origin}/target` })
      response.end()
    })
    expect(await errorCode(postJson(options(`${source.origin}/redirect`)))).toBe('VISION_UPSTREAM_PROTOCOL')
    expect(target.requests).toHaveLength(0)
  })

  it('treats non-JSON success as a protocol failure', async () => {
    const mock = await server((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('not json')
    })
    expect(await errorCode(postJson(options(mock.origin)))).toBe('VISION_UPSTREAM_PROTOCOL')
  })

  it('streams with a hard response byte cap', async () => {
    const mock = await server((_request, response) => json(response, 200, { text: 'x'.repeat(2_000) }))
    expect(await errorCode(postJson(options(mock.origin, { maxResponseBytes: 100 })))).toBe('VISION_RESPONSE_TOO_LARGE')
  })

  it('returns bounded redacted summaries for non-2xx responses', async () => {
    const secret = 'super-secret-key'
    const mock = await server((_request, response) =>
      json(response, 401, { error: { message: `bad key ${secret} at https://example.test/a?token=${secret}` } }),
    )
    await expect(postJson(options(mock.origin, { secrets: [secret] }))).rejects.toSatisfy((error: VisionBridgeError) => {
      expect(error.code).toBe('VISION_UPSTREAM_HTTP')
      expect(error.message).not.toContain(secret)
      expect(error.message).toContain('[REDACTED]')
      return true
    })
  })

  it('forces exactly one JSON content type even when a caller supplies different casing', async () => {
    const mock = await server((_request, response) => json(response, 200, { ok: true }))
    await postJson(options(mock.origin, { headers: { 'Content-Type': 'text/plain' } }))
    expect(mock.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('retries a transient POST response within the configured budget', async () => {
    const mock = await server((_request, response, index) => {
      if (index === 0) return json(response, 503, { error: 'busy' }, { 'retry-after': '0' })
      return json(response, 200, { ok: true })
    })
    await expect(postJson(options(mock.origin, { maxRetries: 1, maxRetryDelayMs: 20 })))
      .resolves.toMatchObject({ payload: { ok: true } })
    expect(mock.requests).toHaveLength(2)
  })

  it('gives idempotent model-list GET requests one bounded retry', async () => {
    const mock = await server((_request, response, index) => {
      if (index === 0) return json(response, 503, { error: 'edge unavailable' })
      return json(response, 200, { data: [{ id: 'vision-model' }] })
    })
    const { body: _body, ...request } = options(`${mock.origin}/models`, { maxRetries: 0, maxRetryDelayMs: 10 })
    await expect(getJson(request)).resolves.toMatchObject({ payload: { data: [{ id: 'vision-model' }] } })
    expect(mock.requests).toHaveLength(2)
  })

  it('does not retry terminal 4xx errors', async () => {
    const mock = await server((_request, response) => json(response, 400, { error: 'bad request' }))
    expect(await errorCode(postJson(options(mock.origin, { maxRetries: 2 })))).toBe('VISION_UPSTREAM_HTTP')
    expect(mock.requests).toHaveLength(1)
  })

  it('retries a transient socket failure within the configured budget', async () => {
    const mock = await server((request, response, index) => {
      if (index === 0) {
        request.socket.destroy()
        return
      }
      return json(response, 200, { recovered: true })
    })
    await expect(postJson(options(mock.origin, { maxRetries: 1 })))
      .resolves.toMatchObject({ payload: { recovered: true } })
    expect(mock.requests).toHaveLength(2)
  })

  it('retries a response-body socket failure within the configured budget', async () => {
    const mock = await server((request, response, index) => {
      if (index === 0) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{"partial":')
        response.socket?.destroy()
        return
      }
      return json(response, 200, { recovered: true })
    })
    await expect(postJson(options(mock.origin, { maxRetries: 1 })))
      .resolves.toMatchObject({ payload: { recovered: true } })
    expect(mock.requests).toHaveLength(2)
  })

  it('stops after the configured transient POST retry budget', async () => {
    const mock = await server((_request, response) => json(response, 503, { error: 'busy' }))
    expect(await errorCode(postJson(options(mock.origin, { maxRetries: 2, maxRetryDelayMs: 5 })))).toBe('VISION_UPSTREAM_HTTP')
    expect(mock.requests).toHaveLength(3)
  })

  it('gives every timed-out retry attempt a fresh deadline', async () => {
    const mock = await server((_request, response, index) => {
      if (index === 0) return
      return json(response, 200, { recovered: true })
    })
    await expect(postJson(options(mock.origin, {
      timeoutMs: 20,
      maxRetries: 1,
      maxRetryDelayMs: 5,
    }))).resolves.toMatchObject({ payload: { recovered: true } })
    expect(mock.requests).toHaveLength(2)
  })

  it('classifies timeout and caller abort separately', async () => {
    const mock = await server(() => undefined)
    expect(await errorCode(postJson(options(mock.origin, { timeoutMs: 20 })))).toBe('VISION_TIMEOUT')

    const controller = new AbortController()
    const pending = postJson(options(mock.origin, {
      signal: controller.signal,
      timeoutMs: 1_000,
      maxRetries: 2,
    }))
    await vi.waitFor(() => expect(mock.requests).toHaveLength(2))
    controller.abort(new Error('user canceled'))
    expect(await errorCode(pending)).toBe('VISION_ABORTED')
    expect(mock.requests).toHaveLength(2)
  })
})
