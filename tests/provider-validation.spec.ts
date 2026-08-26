import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, validateConfig } from '../src/config.js'
import type { Protocol } from '../src/provider-contract.js'
import { validateProviderConnection } from '../src/provider-validation.js'
import { discoverProviderModelsForDraft } from '../src/provider-validation.js'
import { modelDiscoveryCredentialReferenceForProfile } from '../src/settings.js'
import * as providerOperations from '../src/provider-validation.js'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'

const png = readFileSync(new URL('../fixtures/tiny.png', import.meta.url))
const servers: MockServer[] = []

afterEach(async () => Promise.all(servers.splice(0).map(server => server.close())))

function context(secret = 'test-secret') {
  const credentials = { resolve: vi.fn(async () => ({ value: secret, source: 'test' })) }
  const attachments = { validateImage: vi.fn(async () => undefined) }
  return {
    value: { credentials, attachments } as unknown as Pick<Context, 'credentials' | 'attachments'>,
    credentials,
    attachments,
  }
}

const cases: readonly {
  protocol: Protocol
  path: string
  response: unknown
  outputLimitField: string
}[] = [
  {
    protocol: 'openai-responses',
    path: '/responses',
    response: { output_text: 'OK' },
    outputLimitField: 'max_output_tokens',
  },
  {
    protocol: 'openai-chat-completions',
    path: '/chat/completions',
    response: { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] },
    outputLimitField: 'max_completion_tokens',
  },
  {
    protocol: 'anthropic-messages',
    path: '/v1/messages',
    response: { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' },
    outputLimitField: 'max_tokens',
  },
]

describe('saved-provider connection validation', () => {
  it('discovers models for an unsaved editor scheme through an authorized temporary credential ref', async () => {
    const upstream = await startServer((_request, response) => json(response, 200, {
      object: 'list',
      data: [{ id: 'vision-new', object: 'model' }],
    }))
    servers.push(upstream)
    const ctx = context()
    const config = validateConfig(Config({}))
    const credential = modelDiscoveryCredentialReferenceForProfile('new-scheme', 'lookup-1')

    await expect(discoverProviderModelsForDraft(ctx.value, config, {
      providerId: 'new-scheme',
      protocol: 'openai-responses',
      baseUrl: upstream.origin,
      credential,
    }, new AbortController().signal)).resolves.toEqual(['vision-new'])
    expect(ctx.credentials.resolve).toHaveBeenCalledWith(credential)
    expect(upstream.requests[0]?.url).toBe('/models')
  })

  it('rejects an arbitrary credential ref before resolution', async () => {
    const ctx = context()
    const config = validateConfig(Config({}))

    await expect(discoverProviderModelsForDraft(ctx.value, config, {
      providerId: 'new-scheme',
      protocol: 'openai-responses',
      baseUrl: 'https://vision.example.test/v1',
      credential: 'SOME_OTHER_PLUGIN_SECRET',
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'VISION_CREDENTIAL_MISSING' })
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
  })

  it.each([
    ['openai-responses', '/models', { object: 'list', data: [{ id: 'responses-vision', object: 'model' }] }],
    ['openai-chat-completions', '/models', { object: 'list', data: [{ id: 'chat-vision', object: 'model' }] }],
    ['anthropic-messages', '/v1/models?limit=1000', { data: [{ id: 'claude-vision', type: 'model' }] }],
  ] as const)('discovers saved-provider models through the %s adapter', async (protocol, path, responseBody) => {
    const discover = (providerOperations as typeof providerOperations & {
      discoverProviderModels?: typeof validateProviderConnection extends (...args: infer Args) => unknown
        ? (...args: Args) => Promise<readonly string[]>
        : never
    }).discoverProviderModels
    expect(discover).toBeTypeOf('function')
    if (discover === undefined) return
    const upstream = await startServer((_request, response) => json(response, 200, responseBody))
    servers.push(upstream)
    const ctx = context()
    const config = validateConfig(Config({ providers: [{
      id: 'primary',
      protocol,
      baseUrl: upstream.origin,
      model: 'vision-model',
      credential: 'VISION_API_KEY',
      ...(protocol === 'anthropic-messages' ? { maxOutputTokens: 4_096 } : {}),
    }] }))

    await expect(discover(ctx.value, config, 'primary', new AbortController().signal))
      .resolves.toEqual([protocol === 'openai-responses'
        ? 'responses-vision'
        : protocol === 'openai-chat-completions' ? 'chat-vision' : 'claude-vision'])
    expect(upstream.requests[0]?.url).toBe(path)
  })

  it.each(cases)('sends one bounded real multimodal request through $protocol', async (testCase) => {
    const upstream = await startServer((_request, response) => json(response, 200, testCase.response))
    servers.push(upstream)
    const ctx = context()
    const config = validateConfig(Config({
      providers: [{
        id: 'primary',
        protocol: testCase.protocol,
        baseUrl: upstream.origin,
        model: 'vision-model',
        credential: 'VISION_API_KEY',
        ...(testCase.protocol === 'anthropic-messages' ? { maxOutputTokens: 4_096 } : {}),
      }],
    }))

    await expect(validateProviderConnection(
      ctx.value,
      config,
      'primary',
      new AbortController().signal,
    )).resolves.toBeUndefined()

    expect(ctx.attachments.validateImage).toHaveBeenCalledWith({
      data: new Uint8Array(png),
      mediaType: 'image/png',
      name: 'open-eyes-connection-test.png',
    })
    expect(upstream.requests).toHaveLength(1)
    expect(upstream.requests[0]?.url).toBe(testCase.path)
    expect(upstream.requests[0]?.headers.authorization ?? upstream.requests[0]?.headers['x-api-key'])
      .toContain('test-secret')
    const body = upstream.requests[0]?.body as Record<string, unknown>
    expect(body.model).toBe('vision-model')
    expect(body[testCase.outputLimitField]).toBe(256)
    expect(JSON.stringify(body)).toContain(png.toString('base64'))
    expect(JSON.stringify(body)).toContain('Reply with OK')
  })

  it('rejects an unknown scheme before resolving credentials or contacting an upstream', async () => {
    const upstream = await startServer((_request, response) => json(response, 200, { output_text: 'OK' }))
    servers.push(upstream)
    const ctx = context()
    const config = validateConfig(Config({ providers: [{
      id: 'primary',
      protocol: 'openai-responses',
      baseUrl: upstream.origin,
      model: 'vision-model',
      credential: 'VISION_API_KEY',
    }] }))

    await expect(validateProviderConnection(ctx.value, config, 'missing', new AbortController().signal))
      .rejects.toMatchObject({ code: 'VISION_PROVIDER_NOT_FOUND' })
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
    expect(upstream.requests).toHaveLength(0)
  })
})
