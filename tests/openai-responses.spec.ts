import { afterEach, describe, expect, it } from 'vitest'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import { provider, request } from './helpers/adapter.js'
import { analyzeOpenAIResponses } from '../src/providers/openai-responses.js'
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

describe('OpenAI Responses adapter', () => {
  it('owns its exact URL, headers, JSON body, and local/remote image forms', async () => {
    const mock = await server((_request, response) => json(response, 200, { id: 'resp-1', output_text: 'answer', status: 'completed' }))
    const config = provider('openai-responses', `${mock.origin}/v1`, {
      headers: { 'x-tenant': 'tenant-a' },
      extraBody: { temperature: 0.2 },
    })
    await analyzeOpenAIResponses(request(config))
    expect(mock.requests[0]?.url).toBe('/v1/responses')
    expect(mock.requests[0]?.headers).toMatchObject({
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
      'x-tenant': 'tenant-a',
    })
    expect(mock.requests[0]?.body).toEqual({
      temperature: 0.2,
      model: 'vision-model',
      instructions: SAFETY_INSTRUCTION,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'data:image/png;base64,AQID', detail: 'high' },
            {
              type: 'input_image',
              image_url: 'https://images.example.test/a.png?signature=opaque',
              detail: 'high',
            },
            { type: 'input_text', text: 'Read the exact error code.' },
          ],
        },
      ],
      max_output_tokens: 123,
      store: false,
      stream: false,
    })
  })

  it('parses message output blocks, usage, request id, and status', async () => {
    const mock = await server((_request, response) =>
      json(
        response,
        200,
        {
          id: 'payload-id',
          output: [
            { type: 'reasoning', content: [{ type: 'output_text', text: 'ignored' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'hello ' }, { type: 'output_text', text: 'world' }] },
          ],
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          status: 'completed',
        },
        { 'x-request-id': 'header-id' },
      ),
    )
    await expect(analyzeOpenAIResponses(request(provider('openai-responses', mock.origin)))).resolves.toEqual({
      text: 'hello world',
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      requestId: 'header-id',
      finishReason: 'completed',
    })
  })

  it('accepts a base URL that already contains the Responses endpoint', async () => {
    const mock = await server((_request, response) => json(response, 200, { output_text: 'answer' }))

    await analyzeOpenAIResponses(request(provider('openai-responses', `${mock.origin}/gateway/v1/responses`)))

    expect(mock.requests[0]?.url).toBe('/gateway/v1/responses')
  })

  it('rejects empty content and defensively rejects reserved extraBody fields', async () => {
    const mock = await server((_request, response) => json(response, 200, { output: [] }))
    const config = provider('openai-responses', mock.origin)
    expect(await codeOf(analyzeOpenAIResponses(request(config)))).toBe('VISION_UPSTREAM_PROTOCOL')
    const forged = { ...config, extraBody: { input: [] } }
    expect(await codeOf(analyzeOpenAIResponses(request(forged)))).toBe('VISION_INVALID_ARGUMENT')
  })

  it('classifies non-JSON, HTTP, oversized, timeout, and caller abort failures', async () => {
    const nonJson = await server((_request, response) => {
      response.end('not json')
    })
    expect(await codeOf(analyzeOpenAIResponses(request(provider('openai-responses', nonJson.origin))))).toBe(
      'VISION_UPSTREAM_PROTOCOL',
    )
    const secret = 'test-secret'
    const denied = await server((_request, response) => json(response, 401, { error: { message: `denied ${secret}` } }))
    await expect(analyzeOpenAIResponses(request(provider('openai-responses', denied.origin)))).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining(secret),
    )
    const large = await server((_request, response) => json(response, 200, { output_text: 'x'.repeat(1_000) }))
    const largeRequest = request(provider('openai-responses', large.origin))
    expect(
      await codeOf(
        analyzeOpenAIResponses({ ...largeRequest, transport: { ...largeRequest.transport, maxResponseBytes: 100 } }),
      ),
    ).toBe('VISION_RESPONSE_TOO_LARGE')
    const slow = await server(() => undefined)
    const slowRequest = request(provider('openai-responses', slow.origin))
    expect(
      await codeOf(analyzeOpenAIResponses({ ...slowRequest, transport: { ...slowRequest.transport, timeoutMs: 20 } })),
    ).toBe('VISION_TIMEOUT')
    const controller = new AbortController()
    controller.abort()
    expect(
      await codeOf(
        analyzeOpenAIResponses({ ...slowRequest, transport: { ...slowRequest.transport, signal: controller.signal } }),
      ),
    ).toBe('VISION_ABORTED')
  })
})
