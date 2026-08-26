import { afterEach, describe, expect, it } from 'vitest'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import { provider, request } from './helpers/adapter.js'
import { analyzeAnthropicMessages } from '../src/providers/anthropic-messages.js'
import { SAFETY_INSTRUCTION } from '../src/providers/types.js'
import { VisionBridgeError } from '../src/errors.js'

const servers: MockServer[] = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())))
async function server(handler: Parameters<typeof startServer>[0]) {
  const value = await startServer(handler)
  servers.push(value)
  return value
}
async function codeOf(value: Promise<unknown>) {
  try {
    await value
  } catch (error) {
    return (error as VisionBridgeError).code
  }
}

describe('Anthropic Messages adapter', () => {
  it('owns its exact URL, headers, JSON body, and base64/URL source forms', async () => {
    const mock = await server((_request, response) => json(response, 200, { content: [{ type: 'text', text: 'answer' }] }))
    const config = provider('anthropic-messages', mock.origin, {
      authMode: 'x-api-key',
      anthropicVersion: '2023-06-01',
      headers: { 'x-tenant': 'tenant-c', 'Anthropic-Version': '1900-01-01' },
      extraBody: { temperature: 0.1 },
    })
    await analyzeAnthropicMessages(
      request(config, { authHeaders: { 'x-api-key': 'test-secret' } }),
    )
    expect(mock.requests[0]?.url).toBe('/v1/messages')
    expect(mock.requests[0]?.headers).toMatchObject({
      'x-api-key': 'test-secret',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-tenant': 'tenant-c',
    })
    expect(mock.requests[0]?.body).toEqual({
      temperature: 0.1,
      model: 'vision-model',
      system: SAFETY_INSTRUCTION,
      max_tokens: 123,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
            { type: 'image', source: { type: 'url', url: 'https://images.example.test/a.png?signature=opaque' } },
            { type: 'text', text: 'Read the exact error code.' },
          ],
        },
      ],
      stream: false,
    })
  })

  it('joins only text blocks and normalizes usage, request id, and stop reason', async () => {
    const mock = await server((_request, response) =>
      json(
        response,
        200,
        {
          id: 'payload-id',
          content: [
            { type: 'thinking', thinking: 'ignored' },
            { type: 'text', text: 'visible ' },
            { type: 'tool_use', name: 'ignored' },
            { type: 'text', text: 'text' },
          ],
          usage: { input_tokens: 30, output_tokens: 7 },
          stop_reason: 'end_turn',
        },
        { 'anthropic-request-id': 'anthropic-header' },
      ),
    )
    await expect(analyzeAnthropicMessages(request(provider('anthropic-messages', mock.origin)))).resolves.toEqual({
      text: 'visible text',
      usage: { input_tokens: 30, output_tokens: 7, total_tokens: 37 },
      requestId: 'anthropic-header',
      finishReason: 'end_turn',
    })
  })

  it('accepts a base URL that already contains the Messages endpoint', async () => {
    const mock = await server((_request, response) => json(response, 200, { content: [{ type: 'text', text: 'answer' }] }))

    await analyzeAnthropicMessages(request(provider('anthropic-messages', `${mock.origin}/gateway/v1/messages`)))

    expect(mock.requests[0]?.url).toBe('/gateway/v1/messages')
  })

  it('rejects invalid/empty content and reserved body overrides', async () => {
    const mock = await server((_request, response) => json(response, 200, { content: [{ type: 'thinking', thinking: 'x' }] }))
    const config = provider('anthropic-messages', mock.origin)
    expect(await codeOf(analyzeAnthropicMessages(request(config)))).toBe('VISION_UPSTREAM_PROTOCOL')
    expect(await codeOf(analyzeAnthropicMessages(request({ ...config, extraBody: { system: 'override' } })))).toBe(
      'VISION_INVALID_ARGUMENT',
    )
  })

  it('propagates non-JSON, HTTP, size, timeout, abort, and secret-redaction behavior', async () => {
    const nonJson = await server((_request, response) => {
      response.end('not-json')
    })
    expect(await codeOf(analyzeAnthropicMessages(request(provider('anthropic-messages', nonJson.origin))))).toBe(
      'VISION_UPSTREAM_PROTOCOL',
    )
    const denied = await server((_request, response) => json(response, 401, { error: { message: 'bad test-secret' } }))
    await expect(analyzeAnthropicMessages(request(provider('anthropic-messages', denied.origin)))).rejects.toSatisfy(
      (error: VisionBridgeError) => error.code === 'VISION_UPSTREAM_HTTP' && !error.message.includes('test-secret'),
    )
    const large = await server((_request, response) => json(response, 200, { content: [{ type: 'text', text: 'x'.repeat(1_000) }] }))
    const largeRequest = request(provider('anthropic-messages', large.origin))
    expect(
      await codeOf(analyzeAnthropicMessages({ ...largeRequest, transport: { ...largeRequest.transport, maxResponseBytes: 80 } })),
    ).toBe('VISION_RESPONSE_TOO_LARGE')
    const slow = await server(() => undefined)
    const slowRequest = request(provider('anthropic-messages', slow.origin))
    expect(
      await codeOf(analyzeAnthropicMessages({ ...slowRequest, transport: { ...slowRequest.transport, timeoutMs: 20 } })),
    ).toBe('VISION_TIMEOUT')
    const controller = new AbortController()
    controller.abort()
    expect(
      await codeOf(analyzeAnthropicMessages({ ...slowRequest, transport: { ...slowRequest.transport, signal: controller.signal } })),
    ).toBe('VISION_ABORTED')
  })
})
