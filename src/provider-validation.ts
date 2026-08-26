import type { Context } from '@deepseek-ai/cordis'
import { validateConfig, type ResolvedConfig, type ResolvedProviderConfig } from './config.js'
import { resolveProviderAuth } from './credentials.js'
import { aborted, sanitizedError, VisionBridgeError } from './errors.js'
import { dispatchAdapter, dispatchModelDiscovery } from './providers/dispatch.js'
import { isModelDiscoveryCredentialReferenceForProfile } from './settings-contract.js'
import type { WebProviderModelsDraft } from './web-contract.js'

const VALIDATION_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMQybvzHx9mGBkKAJyrl0HDp93DAAAAAElFTkSuQmCC'
const VALIDATION_IMAGE = Uint8Array.from(Buffer.from(VALIDATION_IMAGE_BASE64, 'base64'))
const VALIDATION_PROMPT = 'Reply with OK if you can process this image.'
const VALIDATION_OUTPUT_TOKENS = 256

type ValidationContext = Pick<Context, 'credentials' | 'attachments'>

function providerFor(config: ResolvedConfig, providerId: string): ResolvedProviderConfig {
  const provider = config.providers.find(candidate => candidate.id === providerId)
  if (provider === undefined) {
    throw new VisionBridgeError('VISION_PROVIDER_NOT_FOUND', 'requested vision provider is not configured')
  }
  return provider
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted(signal.reason)
}

/**
 * Perform one user-triggered, bounded multimodal request for a saved provider.
 * The upstream output is deliberately discarded and never crosses the Web route.
 */
export async function validateProviderConnection(
  ctx: ValidationContext,
  config: ResolvedConfig,
  providerId: string,
  signal: AbortSignal,
): Promise<void> {
  const provider = providerFor(config, providerId)
  let secrets: readonly string[] = [...Object.values(provider.headers), VALIDATION_IMAGE_BASE64]
  try {
    checkAborted(signal)
    await ctx.attachments.validateImage({
      data: VALIDATION_IMAGE,
      mediaType: 'image/png',
      name: 'open-eyes-connection-test.png',
    })
    checkAborted(signal)
    const auth = await resolveProviderAuth(ctx, provider)
    secrets = [...secrets, ...auth.secrets]
    await dispatchAdapter({
      provider: { ...provider, maxOutputTokens: VALIDATION_OUTPUT_TOKENS },
      images: [{
        kind: 'local',
        mediaType: 'image/png',
        base64: VALIDATION_IMAGE_BASE64,
        byteLength: VALIDATION_IMAGE.byteLength,
      }],
      prompt: VALIDATION_PROMPT,
      detail: 'low',
      authHeaders: auth.headers,
      secrets,
      transport: {
        signal,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        maxRetries: config.maxRetries,
        maxRetryDelayMs: config.maxRetryDelayMs,
      },
    })
  } catch (error) {
    throw sanitizedError(error, secrets)
  }
}

/** Fetch the bounded model ids exposed by one saved provider without crossing credentials into Web. */
export async function discoverProviderModels(
  ctx: Pick<Context, 'credentials'>,
  config: ResolvedConfig,
  providerId: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const provider = providerFor(config, providerId)
  let secrets: readonly string[] = Object.values(provider.headers)
  try {
    checkAborted(signal)
    const auth = await resolveProviderAuth(ctx, provider)
    secrets = [...secrets, ...auth.secrets]
    return await dispatchModelDiscovery({
      provider,
      authHeaders: auth.headers,
      secrets,
      transport: {
        signal,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
        maxRetries: config.maxRetries,
        maxRetryDelayMs: config.maxRetryDelayMs,
      },
    })
  } catch (error) {
    throw sanitizedError(error, secrets)
  }
}

/** Discover models for saved or editor metadata while authorizing only known credential refs. */
export async function discoverProviderModelsForDraft(
  ctx: Pick<Context, 'credentials'>,
  config: ResolvedConfig,
  draft: WebProviderModelsDraft,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const saved = config.providers.find(provider => provider.id === draft.providerId)
  if (draft.credential !== undefined
    && !isModelDiscoveryCredentialReferenceForProfile(draft.providerId, draft.credential)
    && draft.credential !== saved?.credential) {
    throw new VisionBridgeError('VISION_CREDENTIAL_MISSING', 'model discovery credential is not authorized')
  }
  const authMode = draft.authMode
    ?? (saved?.protocol === draft.protocol ? saved.authMode : undefined)
  const credential = authMode === 'none' ? undefined : draft.credential ?? saved?.credential
  const sameProtocol = saved?.protocol === draft.protocol
  const runtime = {
    enabled: config.enabled,
    preference: config.preference,
    visualAnalysis: config.visualAnalysis,
    focusAreas: [...config.focusAreas],
    timeoutMs: config.timeoutMs,
    maxImageBytes: config.maxImageBytes,
    maxImages: config.maxImages,
    maxPromptChars: config.maxPromptChars,
    maxOutputChars: config.maxOutputChars,
    maxResponseBytes: config.maxResponseBytes,
    maxRetries: config.maxRetries,
    maxRetryDelayMs: config.maxRetryDelayMs,
    allowRemoteUrls: config.allowRemoteUrls,
    allowOutsideWorkspace: config.allowOutsideWorkspace,
    extraAllowedRoots: [...config.extraAllowedRoots],
    allowInsecureHttp: config.allowInsecureHttp,
  }
  const resolved = validateConfig({
    ...runtime,
    providers: [{
      id: draft.providerId,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl,
      model: '__model_discovery__',
      ...(draft.endpointPath === undefined ? {} : { endpointPath: draft.endpointPath }),
      ...(authMode === undefined ? {} : { authMode }),
      ...(credential === undefined ? {} : { credential }),
      ...(sameProtocol && saved !== undefined
        ? {
            headers: { ...saved.headers },
            ...(saved.anthropicVersion === undefined ? {} : { anthropicVersion: saved.anthropicVersion }),
          }
        : {}),
    }],
    defaultProvider: draft.providerId,
  })
  return discoverProviderModels(ctx, resolved, draft.providerId, signal)
}
