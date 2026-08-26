import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { VisionBridgeConfigError } from './errors.js'
import { AUTH_MODES, PROTOCOLS, type AuthMode, type Protocol } from './provider-contract.js'
import { MAX_PREFERENCE_CHARS } from './settings-contract.js'
import {
  VISUAL_ANALYSIS_MODES,
  VISUAL_FOCUS_AREAS,
  normalizeFocusAreas,
  normalizeVisualAnalysis,
  type VisualAnalysisMode,
  type VisualFocusArea,
} from './visual-preferences.js'

export { AUTH_MODES, PROTOCOLS, type AuthMode, type Protocol } from './provider-contract.js'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ProviderConfig {
  id: string
  protocol: Protocol
  baseUrl: string
  endpointPath?: string
  model: string
  authMode?: AuthMode
  credential?: string
  headers?: Record<string, string>
  maxOutputTokens?: number
  extraBody?: Record<string, JsonValue>
  chatMaxTokensField?: 'max_tokens' | 'max_completion_tokens'
  anthropicVersion?: string
}

export interface Config {
  enabled: boolean
  preference: string
  visualAnalysis: VisualAnalysisMode
  focusAreas: VisualFocusArea[]
  providers: ProviderConfig[]
  defaultProvider?: string
  timeoutMs: number
  maxImageBytes: number
  maxImages: number
  maxPromptChars: number
  maxOutputChars: number
  maxResponseBytes: number
  maxRetries: number
  maxRetryDelayMs: number
  allowRemoteUrls: boolean
  allowOutsideWorkspace: boolean
  extraAllowedRoots: string[]
  allowInsecureHttp: boolean
}

export interface ConfigInput extends Partial<Omit<Config, 'providers'>> {
  providers?: ProviderConfig[]
}

export interface ResolvedProviderConfig {
  readonly id: string
  readonly protocol: Protocol
  readonly baseUrl: string
  readonly endpointPath: string
  readonly model: string
  readonly authMode: AuthMode
  readonly credential: string | undefined
  readonly headers: Readonly<Record<string, string>>
  readonly maxOutputTokens: number | undefined
  readonly extraBody: Readonly<Record<string, JsonValue>>
  readonly chatMaxTokensField: 'max_tokens' | 'max_completion_tokens'
  readonly anthropicVersion: string
}

export interface ResolvedConfig extends Omit<Config, 'providers'> {
  readonly providers: readonly ResolvedProviderConfig[]
}

const ProviderSchema = z.object({
  id: z.string().required(),
  protocol: z.union(PROTOCOLS.map((value) => z.const(value))).required(),
  baseUrl: z.string().required(),
  endpointPath: z.string(),
  model: z.string().required(),
  authMode: z.union(AUTH_MODES.map((value) => z.const(value))),
  credential: z.string(),
  headers: z.dict(z.string()),
  maxOutputTokens: z.natural(),
  extraBody: z.any<Record<string, JsonValue>>(),
  chatMaxTokensField: z.union([z.const('max_tokens'), z.const('max_completion_tokens')]),
  anthropicVersion: z.string(),
})

export const Config = z.object({
  enabled: z.boolean().default(true),
  preference: z.string().default(''),
  visualAnalysis: z.union(VISUAL_ANALYSIS_MODES.map(value => z.const(value))).default('default'),
  focusAreas: z.array(z.union(VISUAL_FOCUS_AREAS.map(value => z.const(value)))).default([]),
  providers: z.array(ProviderSchema).default([]),
  defaultProvider: z.string(),
  timeoutMs: z.natural().default(300_000),
  maxImageBytes: z.natural().default(10 * 1024 * 1024),
  maxImages: z.natural().default(4),
  maxPromptChars: z.natural().default(16_000),
  maxOutputChars: z.natural().default(32_000),
  maxResponseBytes: z.natural().default(2 * 1024 * 1024),
  maxRetries: z.natural().default(2),
  maxRetryDelayMs: z.natural().default(5_000),
  allowRemoteUrls: z.boolean().default(false),
  allowOutsideWorkspace: z.boolean().default(false),
  extraAllowedRoots: z.array(z.string()).default([]),
  allowInsecureHttp: z.boolean().default(false),
}) as unknown as z<ConfigInput, Config>

export const RESERVED_BODY_FIELDS: Readonly<Record<Protocol, ReadonlySet<string>>> = {
  'openai-responses': new Set(['model', 'instructions', 'input', 'max_output_tokens', 'store', 'stream']),
  'openai-chat-completions': new Set(['model', 'messages', 'max_tokens', 'max_completion_tokens', 'stream']),
  'anthropic-messages': new Set(['model', 'system', 'max_tokens', 'messages', 'stream']),
}

const FORBIDDEN_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
])

const LIMITS = {
  timeoutMs: 10 * 60_000,
  maxImageBytes: 64 * 1024 * 1024,
  maxImages: 32,
  maxPromptChars: 1_000_000,
  maxOutputChars: 1_000_000,
  maxResponseBytes: 64 * 1024 * 1024,
  maxRetries: 10,
  maxRetryDelayMs: 5 * 60_000,
  maxOutputTokens: 1_000_000,
} as const

export const MAX_TOTAL_LOCAL_IMAGE_BYTES = 64 * 1024 * 1024

const DEFAULT_ENDPOINT: Readonly<Record<Protocol, string>> = {
  'openai-responses': '/responses',
  'openai-chat-completions': '/chat/completions',
  'anthropic-messages': '/v1/messages',
}

function fail(message: string): never {
  throw new VisionBridgeConfigError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateJson(value: unknown, location: string, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    fail(`${location} must contain only finite JSON numbers`)
  }
  if (typeof value !== 'object') fail(`${location} must contain only JSON values`)
  if (seen.has(value)) fail(`${location} must not contain cycles`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, location, seen)
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) fail(`${location} must be a plain JSON object`)
    for (const item of Object.values(value as Record<string, unknown>)) validateJson(item, location, seen)
  }
  seen.delete(value)
}

function validatePositiveInteger(name: keyof typeof LIMITS, value: number, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > LIMITS[name]) {
    fail(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer no greater than ${LIMITS[name]}`)
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function validateHttpUrl(raw: string, location: string, allowInsecureHttp: boolean): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail(`${location} must be a valid absolute URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(`${location} must use http or https`)
  if (url.username || url.password) fail(`${location} must not contain embedded credentials`)
  if (url.hash) fail(`${location} must not contain a fragment`)
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && !allowInsecureHttp) {
    fail(`${location} uses insecure HTTP; enable allowInsecureHttp only for a trusted endpoint`)
  }
  return raw
}

export function validateRemoteUrlPolicy(url: URL, allowInsecureHttp: boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail('remote image URL must use http or https')
  if (url.username || url.password) fail('remote image URL must not contain embedded credentials')
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && !allowInsecureHttp) {
    fail('remote image URL uses insecure HTTP')
  }
}

function validateEndpointPath(value: string, providerId: string): string {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) {
    return fail(`provider ${providerId} endpointPath must start with / and contain no query or fragment`)
  }
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.includes('\\') || decoded.split('/').includes('..')) {
      fail(`provider ${providerId} endpointPath must not contain .. segments`)
    }
  } catch {
    fail(`provider ${providerId} endpointPath contains invalid percent encoding`)
  }
  return value
}

function normalizeHeaders(input: unknown, providerId: string): Readonly<Record<string, string>> {
  if (input === undefined) return Object.freeze({})
  if (!isRecord(input)) return fail(`provider ${providerId} headers must be a string map`)
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_HEADERS.has(key.toLowerCase())) fail(`provider ${providerId} header ${key} is reserved`)
    if (typeof value !== 'string') fail(`provider ${providerId} header ${key} must be a string`)
    try {
      new Headers({ [key]: value })
    } catch {
      fail(`provider ${providerId} contains an invalid header name or value`)
    }
    output[key] = value
  }
  return Object.freeze(output)
}

function normalizeExtraBody(input: unknown, protocol: Protocol, providerId: string): Readonly<Record<string, JsonValue>> {
  if (input === undefined) return Object.freeze({})
  if (!isRecord(input)) return fail(`provider ${providerId} extraBody must be a plain JSON object`)
  validateJson(input, `provider ${providerId} extraBody`)
  for (const key of Object.keys(input)) {
    if (RESERVED_BODY_FIELDS[protocol].has(key)) fail(`provider ${providerId} extraBody field ${key} is adapter-owned`)
  }
  return Object.freeze({ ...(input as Record<string, JsonValue>) })
}

function resolveProvider(provider: ProviderConfig, allowInsecureHttp: boolean): ResolvedProviderConfig {
  const id = typeof provider.id === 'string' ? provider.id : ''
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id)) fail('provider id must be safe and match /^[a-z0-9][a-z0-9._-]*$/')
  if (!(PROTOCOLS as readonly unknown[]).includes(provider.protocol)) fail(`provider ${id} has an unsupported protocol`)
  const protocol = provider.protocol as Protocol
  if (typeof provider.model !== 'string' || !provider.model.trim()) fail(`provider ${id} model must be non-empty`)
  const baseUrl = validateHttpUrl(provider.baseUrl, `provider ${id} baseUrl`, allowInsecureHttp)
  const endpointPath = validateEndpointPath(provider.endpointPath ?? DEFAULT_ENDPOINT[protocol], id)
  const authMode = provider.authMode ?? (protocol === 'anthropic-messages' ? 'x-api-key' : 'bearer')
  if (!(AUTH_MODES as readonly unknown[]).includes(authMode)) fail(`provider ${id} has an unsupported authMode`)
  if (authMode === 'none') {
    if (provider.credential !== undefined) fail(`provider ${id} credential must not be set when authMode is none`)
  } else if (typeof provider.credential !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(provider.credential)) {
    fail(`provider ${id} requires a valid Credential Reference`)
  }
  if (provider.maxOutputTokens !== undefined) validatePositiveInteger('maxOutputTokens', provider.maxOutputTokens)
  if (protocol === 'anthropic-messages' && provider.maxOutputTokens === undefined) {
    fail(`provider ${id} maxOutputTokens is required by anthropic-messages`)
  }
  if (provider.anthropicVersion !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(provider.anthropicVersion)) {
    fail(`provider ${id} anthropicVersion must use YYYY-MM-DD`)
  }
  return Object.freeze({
    id,
    protocol,
    baseUrl,
    endpointPath,
    model: provider.model.trim(),
    authMode,
    credential: provider.credential,
    headers: normalizeHeaders(provider.headers, id),
    maxOutputTokens: provider.maxOutputTokens,
    extraBody: normalizeExtraBody(provider.extraBody, protocol, id),
    chatMaxTokensField: provider.chatMaxTokensField ?? 'max_completion_tokens',
    anthropicVersion: provider.anthropicVersion ?? '2023-06-01',
  })
}

function normalizeRoots(roots: readonly string[]): string[] {
  const output: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    if (typeof root !== 'string' || !root.trim()) fail('extraAllowedRoots entries must be non-empty strings')
    const normalized = path.normalize(root.trim())
    if (!seen.has(normalized)) {
      seen.add(normalized)
      output.push(normalized)
    }
  }
  return output
}

export function validateConfig(input: Config): ResolvedConfig {
  if (typeof input.preference !== 'string') fail('preference must be a string')
  const preference = input.preference.trim()
  if ([...preference].length > MAX_PREFERENCE_CHARS) {
    fail(`preference must be no longer than ${MAX_PREFERENCE_CHARS} characters`)
  }
  let visualAnalysis: VisualAnalysisMode
  let focusAreas: VisualFocusArea[]
  try {
    visualAnalysis = normalizeVisualAnalysis(input.visualAnalysis)
    focusAreas = normalizeFocusAreas(input.focusAreas)
  } catch {
    fail('visual preferences contain an unsupported option')
  }
  validatePositiveInteger('timeoutMs', input.timeoutMs)
  validatePositiveInteger('maxImageBytes', input.maxImageBytes)
  validatePositiveInteger('maxImages', input.maxImages)
  validatePositiveInteger('maxPromptChars', input.maxPromptChars)
  validatePositiveInteger('maxOutputChars', input.maxOutputChars)
  validatePositiveInteger('maxResponseBytes', input.maxResponseBytes)
  validatePositiveInteger('maxRetries', input.maxRetries, true)
  validatePositiveInteger('maxRetryDelayMs', input.maxRetryDelayMs)
  if (input.maxImageBytes * input.maxImages > MAX_TOTAL_LOCAL_IMAGE_BYTES) {
    fail('maxImageBytes multiplied by maxImages must not exceed the 64 MiB aggregate local-image limit')
  }

  const providers = input.providers.map((provider) => resolveProvider(provider, input.allowInsecureHttp))
  const ids = new Set<string>()
  for (const provider of providers) {
    if (ids.has(provider.id)) fail('provider ids must be unique')
    ids.add(provider.id)
  }

  let defaultProvider = input.defaultProvider
  if (providers.length === 0) {
    if (defaultProvider !== undefined) fail('defaultProvider cannot be set while providers is empty')
  } else if (providers.length === 1 && defaultProvider === undefined) {
    defaultProvider = providers[0]?.id
  } else if (defaultProvider === undefined || !ids.has(defaultProvider)) {
    fail('defaultProvider must name one configured provider when multiple providers exist')
  }

  return Object.freeze({
    enabled: input.enabled,
    preference,
    visualAnalysis,
    focusAreas: Object.freeze(focusAreas) as unknown as VisualFocusArea[],
    providers: Object.freeze(providers),
    ...(defaultProvider === undefined ? {} : { defaultProvider }),
    timeoutMs: input.timeoutMs,
    maxImageBytes: input.maxImageBytes,
    maxImages: input.maxImages,
    maxPromptChars: input.maxPromptChars,
    maxOutputChars: input.maxOutputChars,
    maxResponseBytes: input.maxResponseBytes,
    maxRetries: input.maxRetries,
    maxRetryDelayMs: input.maxRetryDelayMs,
    allowRemoteUrls: input.allowRemoteUrls,
    allowOutsideWorkspace: input.allowOutsideWorkspace,
    extraAllowedRoots: Object.freeze(normalizeRoots(input.extraAllowedRoots)) as unknown as string[],
    allowInsecureHttp: input.allowInsecureHttp,
  })
}
