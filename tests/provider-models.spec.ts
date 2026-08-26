import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedProviderConfig } from '../src/config.js'
import * as AnthropicAdapter from '../src/providers/anthropic-messages.js'
import * as ChatAdapter from '../src/providers/openai-chat-completions.js'
import * as ResponsesAdapter from '../src/providers/openai-responses.js'
import type { AdapterTransportOptions } from '../src/providers/types.js'
import { provider } from './helpers/adapter.js'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'

const servers: MockServer[] = []
afterEach(async () => Promise.all(servers.splice(0).map(server => server.close())))

interface ModelListRequest {
  readonly provider: ResolvedProviderConfig
  readonly authHeaders: Readonly<Record<string, string>>
  readonly secrets: readonly string[]
  readonly transport: AdapterTransportOptions
}

type ListModels = (request: ModelListRequest) => Promise<readonly string[]>

function modelRequest(providerConfig: ResolvedProviderConfig, authHeaders: Readonly<Record<string, string>>): ModelListRequest {
  return {
    provider: providerConfig,
    authHeaders,
    secrets: ['test-secret'],
    transport: {
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      maxResponseBytes: 4_096,
      maxRetries: 0,
      maxRetryDelayMs: 50,
    },
  }
}

function exportedListModels(module: object, name: string): ListModels | undefined {
  const candidate = (module as Record<string, unknown>)[name]
  expect(candidate).toBeTypeOf('function')
  return typeof candidate === 'function' ? candidate as ListModels : undefined
}

describe('provider model discovery contracts', () => {
  it.each([
    ['openai-responses', ResponsesAdapter, 'listOpenAIResponsesModels'],
    ['openai-chat-completions', ChatAdapter, 'listOpenAIChatCompletionsModels'],
  ] as const)('uses the OpenAI GET /models contract for %s', async (protocol, module, exportName) => {
    const listModels = exportedListModels(module, exportName)
    if (listModels === undefined) return
    const upstream = await startServer((_request, response) => json(response, 200, {
      object: 'list',
      data: [
        { id: 'vision-b', object: 'model', owned_by: 'gateway' },
        { id: 'vision-a', object: 'model', owned_by: 'gateway' },
        { id: 'vision-b', object: 'model', owned_by: 'gateway' },
      ],
    }))
    servers.push(upstream)

    const models = await listModels(modelRequest(
      provider(protocol, `${upstream.origin}/gateway/v1`),
      { authorization: 'Bearer test-secret' },
    ))

    expect(models).toEqual(['vision-b', 'vision-a'])
    expect(upstream.requests[0]).toMatchObject({ method: 'GET', url: '/gateway/v1/models', body: undefined })
    expect(upstream.requests[0]?.headers.authorization).toBe('Bearer test-secret')
    expect(upstream.requests[0]?.headers['content-type']).toBeUndefined()
  })

  it('uses the Anthropic GET /v1/models contract and required version header', async () => {
    const listModels = exportedListModels(AnthropicAdapter, 'listAnthropicMessagesModels')
    if (listModels === undefined) return
    const upstream = await startServer((_request, response) => json(response, 200, {
      data: [{ id: 'claude-vision', type: 'model', display_name: 'Claude Vision' }],
      has_more: false,
      first_id: 'claude-vision',
      last_id: 'claude-vision',
    }))
    servers.push(upstream)

    const models = await listModels(modelRequest(
      provider('anthropic-messages', `${upstream.origin}/gateway`, {
        authMode: 'x-api-key',
        anthropicVersion: '2023-06-01',
      }),
      { 'x-api-key': 'test-secret' },
    ))

    expect(models).toEqual(['claude-vision'])
    expect(upstream.requests[0]).toMatchObject({ method: 'GET', url: '/gateway/v1/models?limit=1000', body: undefined })
    expect(upstream.requests[0]?.headers).toMatchObject({
      'x-api-key': 'test-secret',
      'anthropic-version': '2023-06-01',
    })
    expect(upstream.requests[0]?.headers['content-type']).toBeUndefined()
  })
})
