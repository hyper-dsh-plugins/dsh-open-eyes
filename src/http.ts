import { redactText, takeCodePoints, VisionBridgeError } from './errors.js'

export interface HttpJsonRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  readonly maxRetries: number
  readonly maxRetryDelayMs: number
  readonly secrets: readonly string[]
}

export type HttpJsonGetRequest = Omit<HttpJsonRequest, 'body'>

export interface HttpJsonResponse {
  readonly payload: unknown
  readonly headers: Headers
  readonly status: number
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CLOSED',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])

function causeCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  if (typeof record.code === 'string') return record.code
  return causeCode(record.cause)
}

function isTransientNetworkError(error: unknown): boolean {
  return error instanceof TypeError && RETRYABLE_NETWORK_CODES.has(causeCode(error) ?? '')
}

function classifyAbort(caller: AbortSignal, timeout: AbortSignal): never {
  if (caller.aborted) {
    throw new VisionBridgeError('VISION_ABORTED', 'vision analysis was aborted')
  }
  if (timeout.aborted) {
    throw new VisionBridgeError('VISION_TIMEOUT', 'vision provider request timed out')
  }
  throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'vision provider network request failed')
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new VisionBridgeError('VISION_RESPONSE_TOO_LARGE', 'vision provider response exceeded the configured byte limit')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new VisionBridgeError('VISION_RESPONSE_TOO_LARGE', 'vision provider response exceeded the configured byte limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function parseJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'vision provider returned a non-JSON response')
  }
}

function upstreamSummary(payload: unknown, raw: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const error = record.error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
      return (error as Record<string, unknown>).message as string
    }
    if (typeof record.message === 'string') return record.message
  }
  return raw
}

function boundedSummary(value: string, secrets: readonly string[]): string {
  const compact = redactText(value.replace(/\s+/gu, ' ').trim(), secrets)
  return takeCodePoints(compact, 1_000).text || 'no response details'
}

function retryDelay(value: string | null, attempt: number, maximum: number): number {
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, maximum)
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), maximum)
  }
  return Math.min(250 * 2 ** attempt, maximum)
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms)
    function done() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function requestJson(
  request: HttpJsonGetRequest,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<HttpJsonResponse> {
  // Model discovery remains at least one-retry idempotent. Provider POSTs use
  // the explicitly bounded deployment budget so transient edge, transport,
  // and timeout failures do not become immediate tool failures.
  const maximumRetries = method === 'GET' ? Math.max(1, request.maxRetries) : request.maxRetries

  async function backoff(attempt: number, retryAfter: string | null = null): Promise<void> {
    try {
      await wait(retryDelay(retryAfter, attempt, request.maxRetryDelayMs), request.signal)
    } catch {
      throw new VisionBridgeError('VISION_ABORTED', 'vision analysis was aborted')
    }
  }

  for (let attempt = 0; ; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(request.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeoutSignal])
    let response: Response
    try {
      const headers = new Headers(request.headers)
      if (method === 'POST') headers.set('content-type', 'application/json')
      response = await fetch(request.url, {
        method,
        headers,
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal,
      })
    } catch (error) {
      if (request.signal.aborted) classifyAbort(request.signal, timeoutSignal)
      if (timeoutSignal.aborted) {
        if (attempt < maximumRetries) {
          await backoff(attempt)
          continue
        }
        classifyAbort(request.signal, timeoutSignal)
      }
      if (attempt < maximumRetries && isTransientNetworkError(error)) {
        await backoff(attempt)
        continue
      }
      throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'vision provider network request failed')
    }

    if (!response.ok && RETRYABLE_STATUS.has(response.status) && attempt < maximumRetries) {
      await response.body?.cancel()
      await backoff(attempt, response.headers.get('retry-after'))
      continue
    }

    let bytes: Uint8Array
    try {
      bytes = await readBounded(response, request.maxResponseBytes)
    } catch (error) {
      if (request.signal.aborted) classifyAbort(request.signal, timeoutSignal)
      if (timeoutSignal.aborted) {
        if (attempt < maximumRetries) {
          await backoff(attempt)
          continue
        }
        classifyAbort(request.signal, timeoutSignal)
      }
      if (attempt < maximumRetries && isTransientNetworkError(error)) {
        await response.body?.cancel().catch(() => undefined)
        await backoff(attempt)
        continue
      }
      if (error instanceof TypeError) {
        throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'vision provider network request failed')
      }
      throw error
    }
    const raw = new TextDecoder().decode(bytes)
    if (!response.ok) {
      let payload: unknown
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = undefined
      }
      const summary = boundedSummary(upstreamSummary(payload, raw), request.secrets)
      throw new VisionBridgeError('VISION_UPSTREAM_HTTP', `vision provider returned HTTP ${response.status}: ${summary}`)
    }

    return { payload: parseJson(bytes), headers: response.headers, status: response.status }
  }
}

export async function postJson(request: HttpJsonRequest): Promise<HttpJsonResponse> {
  return requestJson(request, 'POST', request.body)
}

export async function getJson(request: HttpJsonGetRequest): Promise<HttpJsonResponse> {
  return requestJson(request, 'GET')
}
