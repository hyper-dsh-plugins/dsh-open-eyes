import { afterEach, describe, expect, it } from 'vitest'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import { provider, request } from './helpers/adapter.js'
import { analyzeOpenAIChatCompletions } from '../src/providers/openai-chat-completions.js'
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

describe('OpenAI Chat Completions adapter', () => {
  it('owns its exact URL, headers, JSON body, image forms, and token field', async () => {
    const mock = await server((_request, response) => json(response, 200, { choices: [{ message: { content: 'answer' } }] }))
    const config = provider('openai-chat-completions', `${mock.origin}/v1`, {
      headers: { 'x-tenant': 'tenant-b' },
      extraBody: { temperature: 0 },
      chatMaxTokensField: 'max_tokens',
    })
    await analyzeOpenAIChatCompletions(request(config))
    expect(mock.requests[0]?.url).toBe('/v1/chat/completions')
    expect(mock.requests[0]?.headers).toMatchObject({ authorization: 'Bearer test-secret', 'x-tenant': 'tenant-b' })
    expect(mock.requests[0]?.body).toEqual({
      temperature: 0,
      model: 'vision-model',
      messages: [
        { role: 'system', content: SAFETY_INSTRUCTION },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID', detail: 'high' } },
            {
              type: 'image_url',
              image_url: { url: 'https://images.example.test/a.png?signature=opaque', detail: 'high' },
            },
            { type: 'text', text: 'Read the exact error code.' },
          ],
        },
      ],
      max_tokens: 123,
      stream: false,
    })
  })

  it('parses string and multiple explicit text blocks with normalized metadata', async () => {
    const mock = await server((_request, response) =>
      json(
        response,
        200,
        {
          id: 'payload-id',
          choices: [
            {
              message: { content: [{ type: 'text', text: 'error ' }, { type: 'image', text: 'ignored' }, { type: 'text', text: 'E42' }] },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        },
        { 'x-request-id': 'chat-request' },
      ),
    )
    await expect(analyzeOpenAIChatCompletions(request(provider('openai-chat-completions', mock.origin)))).resolves.toEqual({
      text: 'error E42',
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
      requestId: 'chat-request',
      finishReason: 'stop',
    })
  })

  it('accepts a base URL that already contains the Chat Completions endpoint', async () => {
    const mock = await server((_request, response) => json(response, 200, { choices: [{ message: { content: 'answer' } }] }))

    await analyzeOpenAIChatCompletions(request(provider(
      'openai-chat-completions',
      `${mock.origin}/gateway/v1/chat/completions`,
    )))

    expect(mock.requests[0]?.url).toBe('/gateway/v1/chat/completions')
  })

  it('rejects missing choices, empty text, and reserved body overrides', async () => {
    const mock = await server((_request, response) => json(response, 200, { choices: [] }))
    const config = provider('openai-chat-completions', mock.origin)
    expect(await codeOf(analyzeOpenAIChatCompletions(request(config)))).toBe('VISION_UPSTREAM_PROTOCOL')
    expect(
      await codeOf(analyzeOpenAIChatCompletions(request({ ...config, extraBody: { messages: [] } }))),
    ).toBe('VISION_INVALID_ARGUMENT')
  })

  it('propagates bounded transport protocol, HTTP, size, timeout, and abort classes', async () => {
    const nonJson = await server((_request, response) => {
      response.end('not-json')
    })
    expect(await codeOf(analyzeOpenAIChatCompletions(request(provider('openai-chat-completions', nonJson.origin))))).toBe(
      'VISION_UPSTREAM_PROTOCOL',
    )
    const denied = await server((_request, response) => json(response, 403, { error: 'no' }))
    expect(await codeOf(analyzeOpenAIChatCompletions(request(provider('openai-chat-completions', denied.origin))))).toBe(
      'VISION_UPSTREAM_HTTP',
    )
    const large = await server((_request, response) => json(response, 200, { choices: [{ message: { content: 'x'.repeat(1_000) } }] }))
    const largeRequest = request(provider('openai-chat-completions', large.origin))
    expect(
      await codeOf(
        analyzeOpenAIChatCompletions({ ...largeRequest, transport: { ...largeRequest.transport, maxResponseBytes: 80 } }),
      ),
    ).toBe('VISION_RESPONSE_TOO_LARGE')
    const slow = await server(() => undefined)
    const slowRequest = request(provider('openai-chat-completions', slow.origin))
    expect(
      await codeOf(analyzeOpenAIChatCompletions({ ...slowRequest, transport: { ...slowRequest.transport, timeoutMs: 20 } })),
    ).toBe('VISION_TIMEOUT')
    const controller = new AbortController()
    controller.abort()
    expect(
      await codeOf(
        analyzeOpenAIChatCompletions({ ...slowRequest, transport: { ...slowRequest.transport, signal: controller.signal } }),
      ),
    ).toBe('VISION_ABORTED')
  })
})
