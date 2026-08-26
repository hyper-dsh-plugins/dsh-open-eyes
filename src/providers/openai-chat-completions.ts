import { VisionBridgeError } from '../errors.js'
import { getJson, postJson } from '../http.js'
import type { AdapterModelsRequest, AdapterRequest, AdapterResult, NormalizedUsage } from './types.js'
import { SAFETY_INSTRUCTION } from './types.js'

const RESERVED = new Set(['model', 'messages', 'max_tokens', 'max_completion_tokens', 'stream'])

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
  url.pathname = `${basePath}/models`
  return url.toString()
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** OpenAI Chat Completions model discovery owns the OpenAI GET /models contract. */
export async function listOpenAIChatCompletionsModels(request: AdapterModelsRequest): Promise<readonly string[]> {
  const response = await getJson({
    url: modelsUrl(request.provider.baseUrl, request.provider.endpointPath),
    headers: { ...request.provider.headers, ...request.authHeaders },
    secrets: request.secrets,
    ...request.transport,
  })
  const payload = record(response.payload)
  if (!payload || !Array.isArray(payload.data)) {
    throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'OpenAI Chat Completions Models returned invalid data')
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
  const output: NormalizedUsage = {}
  const inputTokens = token(usage.prompt_tokens)
  const outputTokens = token(usage.completion_tokens)
  const totalTokens = token(usage.total_tokens)
  if (inputTokens !== undefined) output.input_tokens = inputTokens
  if (outputTokens !== undefined) output.output_tokens = outputTokens
  if (totalTokens !== undefined) output.total_tokens = totalTokens
  return Object.keys(output).length ? output : null
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const blockValue of value) {
    const block = record(blockValue)
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('')
}

export async function analyzeOpenAIChatCompletions(request: AdapterRequest): Promise<AdapterResult> {
  for (const key of Object.keys(request.provider.extraBody)) {
    if (RESERVED.has(key)) throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `extraBody field ${key} is adapter-owned`)
  }
  const images = request.images.map((image) => ({
    type: 'image_url',
    image_url: {
      url: image.kind === 'local' ? `data:${image.mediaType};base64,${image.base64}` : image.url,
      detail: request.detail,
    },
  }))
  const body: Record<string, unknown> = {
    ...request.provider.extraBody,
    model: request.provider.model,
    messages: [
      { role: 'system', content: SAFETY_INSTRUCTION },
      { role: 'user', content: [...images, { type: 'text', text: request.prompt }] },
    ],
    ...(request.provider.maxOutputTokens === undefined
      ? {}
      : { [request.provider.chatMaxTokensField]: request.provider.maxOutputTokens }),
    stream: false,
  }
  const response = await postJson({
    url: requestUrl(request.provider.baseUrl, request.provider.endpointPath),
    headers: { ...request.provider.headers, ...request.authHeaders, 'content-type': 'application/json' },
    body,
    secrets: request.secrets,
    ...request.transport,
  })
  const payload = record(response.payload)
  if (!payload || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'OpenAI Chat Completions returned no choices')
  }
  const choice = record(payload.choices[0])
  const message = record(choice?.message)
  const text = contentText(message?.content)
  if (!text.trim()) throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'OpenAI Chat Completions returned no text output')
  return {
    text,
    usage: usageOf(payload),
    requestId:
      response.headers.get('x-request-id') || (typeof payload.id === 'string' && payload.id ? payload.id : null),
    finishReason: typeof choice?.finish_reason === 'string' && choice.finish_reason ? choice.finish_reason : null,
  }
}
