import { VisionBridgeError } from '../errors.js'
import { getJson, postJson } from '../http.js'
import type { AdapterModelsRequest, AdapterRequest, AdapterResult, NormalizedUsage } from './types.js'
import { SAFETY_INSTRUCTION } from './types.js'

const RESERVED = new Set(['model', 'system', 'max_tokens', 'messages', 'stream'])

function requestUrl(baseUrl: string, endpointPath: string): string {
  const url = new URL(baseUrl)
  const basePath = url.pathname.replace(/\/+$/u, '')
  url.pathname = basePath.endsWith(endpointPath) ? basePath : `${basePath}${endpointPath}`
  return url.toString()
}

function modelsUrl(baseUrl: string, endpointPath: string): string {
  const url = new URL(baseUrl)
  let basePath = url.pathname.replace(/\/+$/u, '')
  if (basePath.endsWith(endpointPath)) basePath = basePath.slice(0, -endpointPath.length)
  url.pathname = `${basePath}/v1/models`
  url.searchParams.set('limit', '1000')
  return url.toString()
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** Anthropic model discovery owns the GET /v1/models contract and version header. */
export async function listAnthropicMessagesModels(request: AdapterModelsRequest): Promise<readonly string[]> {
  const headers = new Headers(request.provider.headers)
  for (const [key, value] of Object.entries(request.authHeaders)) headers.set(key, value)
  headers.set('anthropic-version', request.provider.anthropicVersion)
  const response = await getJson({
    url: modelsUrl(request.provider.baseUrl, request.provider.endpointPath),
    headers: Object.fromEntries(headers),
    secrets: request.secrets,
    ...request.transport,
  })
  const payload = record(response.payload)
  if (!payload || !Array.isArray(payload.data)) {
    throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'Anthropic Models returned invalid data')
  }
  const models: string[] = []
  const seen = new Set<string>()
  for (const value of payload.data.slice(0, 1_000)) {
    const id = record(value)?.id
    if (typeof id !== 'string' || !id || id.length > 1_024 || seen.has(id)) continue
    seen.add(id)
    models.push(id)
  }
  return models
}

function token(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined
}

function usageOf(payload: Record<string, unknown>): NormalizedUsage | null {
  const usage = record(payload.usage)
  if (!usage) return null
  const inputTokens = token(usage.input_tokens)
  const outputTokens = token(usage.output_tokens)
  const output: NormalizedUsage = {}
  if (inputTokens !== undefined) output.input_tokens = inputTokens
  if (outputTokens !== undefined) output.output_tokens = outputTokens
  if (inputTokens !== undefined && outputTokens !== undefined) output.total_tokens = inputTokens + outputTokens
  return Object.keys(output).length ? output : null
}

export async function analyzeAnthropicMessages(request: AdapterRequest): Promise<AdapterResult> {
  for (const key of Object.keys(request.provider.extraBody)) {
    if (RESERVED.has(key)) throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `extraBody field ${key} is adapter-owned`)
  }
  if (request.provider.maxOutputTokens === undefined) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'anthropic-messages requires maxOutputTokens')
  }
  const images = request.images.map((image) =>
    image.kind === 'local'
      ? {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        }
      : { type: 'image', source: { type: 'url', url: image.url } },
  )
  const body: Record<string, unknown> = {
    ...request.provider.extraBody,
    model: request.provider.model,
    system: SAFETY_INSTRUCTION,
    max_tokens: request.provider.maxOutputTokens,
    messages: [{ role: 'user', content: [...images, { type: 'text', text: request.prompt }] }],
    stream: false,
  }
  const headers = new Headers(request.provider.headers)
  for (const [key, value] of Object.entries(request.authHeaders)) headers.set(key, value)
  headers.set('anthropic-version', request.provider.anthropicVersion)
  const response = await postJson({
    url: requestUrl(request.provider.baseUrl, request.provider.endpointPath),
    headers: Object.fromEntries(headers),
    body,
    secrets: request.secrets,
    ...request.transport,
  })
  const payload = record(response.payload)
  if (!payload || !Array.isArray(payload.content)) {
    throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'Anthropic Messages returned invalid content')
  }
  const parts: string[] = []
  for (const blockValue of payload.content) {
    const block = record(blockValue)
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  const text = parts.join('')
  if (!text.trim()) throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'Anthropic Messages returned no text output')
  return {
    text,
    usage: usageOf(payload),
    requestId:
      response.headers.get('request-id') ||
      response.headers.get('anthropic-request-id') ||
      (typeof payload.id === 'string' && payload.id ? payload.id : null),
    finishReason: typeof payload.stop_reason === 'string' && payload.stop_reason ? payload.stop_reason : null,
  }
}
