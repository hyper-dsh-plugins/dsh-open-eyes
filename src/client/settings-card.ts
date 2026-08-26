import type { AuthMode, Protocol } from '../provider-contract.js'
import {
  WEB_PROVIDER_VALIDATION_ENDPOINT,
  WEB_PROVIDER_MODELS_ENDPOINT,
  WEB_PROVIDER_VALIDATION_DIAGNOSTIC_REASONS,
  WEB_PROVIDER_VALIDATION_ERROR_CODES,
  type WebProviderValidationDiagnostic,
  type WebProviderValidationError,
  type WebProviderModelsDraft,
} from '../web-contract.js'
import {
  credentialReferenceForProfile,
  modelDiscoveryCredentialReferenceForProfile,
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  type VisionBridgeProviderProfile,
  type VisionBridgeEnablementTransition,
} from '../settings-contract.js'
import {
  MAX_CUSTOM_PREFERENCE_UNITS,
  countPreferenceUnits,
  normalizeFocusAreas,
  normalizeVisualAnalysis,
  type VisualAnalysisMode,
  type VisualFocusArea,
} from '../visual-preferences.js'

export { countPreferenceUnits } from '../visual-preferences.js'

interface RpcError {
  readonly code: string
  readonly message: string
}

type RpcResponse<T> = {
  readonly result: { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: RpcError }
}

export interface CredentialStatus {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

export interface SettingsCardApi {
  readonly settings: {
    describe(payload: {}): Promise<RpcResponse<{
      readonly namespaces: readonly {
        readonly ns: string
        readonly value: unknown
      }[]
    }>>
    mutate(payload: {
      readonly ns: string
      readonly ops: readonly (
        | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
        | { readonly op: 'unset'; readonly path: readonly string[] }
      )[]
      readonly expectedRevision?: number
    }): Promise<RpcResponse<unknown>>
  }
  readonly credentials: {
    describe(payload: { readonly refs: readonly string[] }): Promise<RpcResponse<{
      readonly credentials: Readonly<Record<string, CredentialStatus>>
    }>>
    set(payload: { readonly ref: string; readonly value: string }): Promise<RpcResponse<unknown>>
    unset(payload: { readonly ref: string }): Promise<RpcResponse<unknown>>
  }
}

export interface ProviderProfileDraft {
  readonly id: string
  readonly displayName?: string
  readonly protocol: Protocol
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
  readonly credential?: string
  readonly authMode?: AuthMode
}

export type SaveProviderResult =
  | {
    readonly ok: true
    readonly profileCommitted: true
    readonly credentialCommitted: boolean
    readonly id: string
    readonly profile: VisionBridgeProviderProfile
  }
  | {
    readonly ok: false
    readonly profileCommitted: false
    readonly credentialCommitted: boolean
    readonly error: string
  }

export type SettingsWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

export type ProviderValidationResult =
  | { readonly ok: true }
  | {
    readonly ok: false
    readonly error: WebProviderValidationError
    readonly diagnostic?: WebProviderValidationDiagnostic
  }

export type ProviderModelsResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | {
    readonly ok: false
    readonly error: WebProviderValidationError
    readonly diagnostic?: WebProviderValidationDiagnostic
  }

export type PrepareProviderModelDiscoveryResult =
  | {
    readonly ok: true
    readonly draft: WebProviderModelsDraft
    readonly stagedCredential?: string
  }
  | { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validationDiagnostic(value: unknown): WebProviderValidationDiagnostic | undefined {
  if (!isRecord(value) || typeof value.reason !== 'string'
    || !(WEB_PROVIDER_VALIDATION_DIAGNOSTIC_REASONS as readonly string[]).includes(value.reason)) {
    return undefined
  }
  const reason = value.reason as WebProviderValidationDiagnostic['reason']
  const httpStatus = value.httpStatus
  return {
    reason,
    ...(reason === 'http' && typeof httpStatus === 'number' && Number.isInteger(httpStatus)
      && httpStatus >= 100 && httpStatus <= 599
      ? { httpStatus }
      : {}),
  }
}

/** The browser sends only a saved id; credentials remain in the server credential provider. */
export async function requestProviderValidation(
  providerId: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderValidationResult> {
  try {
    const response = await fetcher(WEB_PROVIDER_VALIDATION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId }),
      credentials: 'same-origin',
      redirect: 'error',
    })
    const payload: unknown = await response.json()
    if (response.ok && isRecord(payload) && payload.ok === true) return { ok: true }
    if (isRecord(payload) && payload.ok === false && typeof payload.error === 'string'
      && (WEB_PROVIDER_VALIDATION_ERROR_CODES as readonly string[]).includes(payload.error)) {
      const diagnostic = validationDiagnostic(payload.diagnostic)
      return {
        ok: false,
        error: payload.error as WebProviderValidationError,
        ...(diagnostic === undefined ? {} : { diagnostic }),
      }
    }
  } catch {
    // The UI receives a stable local category, never a browser or upstream error body.
  }
  return { ok: false, error: 'VISION_WEB_INTERNAL' }
}

/** The browser sends only a saved id; the Host resolves endpoint metadata and credentials. */
export async function requestProviderModels(
  draft: WebProviderModelsDraft,
  fetcher: typeof fetch = fetch,
): Promise<ProviderModelsResult> {
  try {
    const response = await fetcher(WEB_PROVIDER_MODELS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
      credentials: 'same-origin',
      redirect: 'error',
    })
    const payload: unknown = await response.json()
    if (response.ok && isRecord(payload) && payload.ok === true && Array.isArray(payload.models)
      && payload.models.length <= 1_000
      && payload.models.every(model => typeof model === 'string' && model.length > 0 && model.length <= 1_024)) {
      return { ok: true, models: payload.models as string[] }
    }
    if (isRecord(payload) && payload.ok === false && typeof payload.error === 'string'
      && (WEB_PROVIDER_VALIDATION_ERROR_CODES as readonly string[]).includes(payload.error)) {
      const diagnostic = validationDiagnostic(payload.diagnostic)
      return {
        ok: false,
        error: payload.error as WebProviderValidationError,
        ...(diagnostic === undefined ? {} : { diagnostic }),
      }
    }
  } catch {
    // The UI receives only the same safe categories as provider validation.
  }
  return { ok: false, error: 'VISION_WEB_INTERNAL' }
}

const PROFILE_ID = /^[a-z0-9][a-z0-9._-]*$/u
const PROTOCOL_ENDPOINT: Readonly<Record<Protocol, string>> = {
  'openai-responses': '/responses',
  'openai-chat-completions': '/chat/completions',
  'anthropic-messages': '/v1/messages',
}

function normalizeEndpointInput(parsed: URL, raw: string, protocol: Protocol): {
  readonly baseUrl: string
  readonly endpointPath?: string
} {
  const endpointPath = PROTOCOL_ENDPOINT[protocol]
  const path = parsed.pathname.replace(/\/+$/u, '')
  if (!path.endsWith(endpointPath)) return { baseUrl: raw }
  const basePath = path.slice(0, -endpointPath.length)
  parsed.pathname = basePath || '/'
  const baseUrl = parsed.pathname === '/'
    ? parsed.origin
    : parsed.toString().replace(/\/$/u, '')
  return { baseUrl, endpointPath }
}

function safeDiscoveryDraft(
  draft: ProviderProfileDraft,
  currentProfile?: VisionBridgeProviderProfile,
): Omit<WebProviderModelsDraft, 'credential'> & { readonly credential?: string } {
  const providerId = draft.id.trim()
  if (!PROFILE_ID.test(providerId)) throw new Error('invalid-profile-id')
  const endpointInput = draft.baseUrl.trim()
  if (endpointInput.length === 0) throw new Error('missing-base-url')
  let parsed: URL
  try {
    parsed = new URL(endpointInput)
  } catch {
    throw new Error('invalid-base-url')
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid-base-url')
  }
  const endpoint = normalizeEndpointInput(parsed, endpointInput, draft.protocol)
  const authMode = draft.authMode
    ?? (currentProfile?.protocol === draft.protocol ? currentProfile.authMode : undefined)
  return {
    providerId,
    protocol: draft.protocol,
    ...endpoint,
    ...(authMode === undefined ? {} : { authMode }),
  }
}

/** Stage an editor key through the official credential service, never through the plugin route. */
export async function prepareProviderModelDiscovery(
  api: SettingsCardApi,
  draft: ProviderProfileDraft,
  currentProfile?: VisionBridgeProviderProfile,
  credentialNonce: string = crypto.randomUUID(),
): Promise<PrepareProviderModelDiscoveryResult> {
  let safe: ReturnType<typeof safeDiscoveryDraft>
  try {
    safe = safeDiscoveryDraft(draft, currentProfile)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid-profile' }
  }
  if (safe.authMode === 'none') return { ok: true, draft: safe }
  const entered = draft.apiKey.trim().length > 0
  const credential = entered
    ? modelDiscoveryCredentialReferenceForProfile(safe.providerId, credentialNonce)
    : draft.credential ?? currentProfile?.credential
  if (credential === undefined) return { ok: false, error: 'missing-api-key' }
  if (entered) {
    try {
      const response = await api.credentials.set({ ref: credential, value: draft.apiKey })
      if (!response.result.ok) return { ok: false, error: 'credential-write-failed' }
    } catch {
      return { ok: false, error: 'credential-write-failed' }
    }
  }
  return {
    ok: true,
    draft: { ...safe, credential },
    ...(entered ? { stagedCredential: credential } : {}),
  }
}

function profileFromDraft(
  draft: ProviderProfileDraft,
  currentProfile: VisionBridgeProviderProfile | undefined,
  freshCredential: string | undefined,
) {
  const id = draft.id.trim()
  if (!PROFILE_ID.test(id)) throw new Error('invalid-profile-id')
  const endpointInput = draft.baseUrl.trim()
  const model = draft.model.trim()
  const displayName = draft.displayName?.trim()
  if (endpointInput.length === 0) throw new Error('missing-base-url')
  if (model.length === 0) throw new Error('missing-model')
  if (displayName !== undefined && displayName.length > 120) throw new Error('invalid-display-name')
  let parsed: URL
  try {
    parsed = new URL(endpointInput)
  } catch {
    throw new Error('invalid-base-url')
  }
  const normalizedEndpoint = normalizeEndpointInput(parsed, endpointInput, draft.protocol)
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid-base-url')
  }
  // A secret is opaque. Whitespace is used only to detect a blank form field;
  // any non-blank value is written byte-for-byte to the credential provider.
  const apiKey = draft.apiKey
  const hasApiKey = apiKey.trim().length > 0
  const authMode = draft.authMode
    ?? (currentProfile?.protocol === draft.protocol ? currentProfile.authMode : undefined)
  const credential = authMode === 'none'
    ? undefined
    : freshCredential ?? draft.credential ?? currentProfile?.credential
  if (authMode !== 'none' && credential === undefined) throw new Error('missing-api-key')
  const preserved: Omit<
    VisionBridgeProviderProfile,
    'displayName' | 'protocol' | 'baseUrl' | 'model' | 'authMode' | 'credential'
  > = currentProfile === undefined
    ? {}
    : {
        ...(currentProfile.protocol !== draft.protocol || currentProfile.endpointPath === undefined
          ? {}
          : { endpointPath: currentProfile.endpointPath }),
        ...(currentProfile.maxOutputTokens === undefined ? {} : { maxOutputTokens: currentProfile.maxOutputTokens }),
        ...(currentProfile.chatMaxTokensField === undefined ? {} : { chatMaxTokensField: currentProfile.chatMaxTokensField }),
        ...(currentProfile.anthropicVersion === undefined ? {} : { anthropicVersion: currentProfile.anthropicVersion }),
      }
  return {
    id,
    apiKey: hasApiKey ? apiKey : undefined,
    credential,
    profile: {
      ...preserved,
      ...normalizedEndpoint,
      protocol: draft.protocol,
      model,
      ...(displayName === undefined || displayName.length === 0 ? {} : { displayName }),
      ...(authMode === undefined ? {} : { authMode }),
      ...(credential === undefined ? {} : { credential }),
      ...(draft.protocol === 'anthropic-messages' && preserved.maxOutputTokens === undefined
        ? { maxOutputTokens: 4_096 }
        : {}),
    },
  }
}

async function committedProfileUsesCredential(
  api: SettingsCardApi,
  profileId: string,
  credential: string,
): Promise<boolean | undefined> {
  try {
    const response = await api.settings.describe({})
    if (!response.result.ok) return undefined
    const namespace = response.result.value.namespaces.find(item => item.ns === VISION_BRIDGE_SETTINGS_NAMESPACE)
    if (namespace === undefined || !isRecord(namespace.value)) return false
    const profiles = namespace.value.profiles
    if (!isRecord(profiles)) return false
    const profile = profiles[profileId]
    return isRecord(profile) && profile.credential === credential
  } catch {
    return undefined
  }
}

async function rollbackCredential(api: SettingsCardApi, credential: string): Promise<boolean> {
  try {
    const response = await api.credentials.unset({ ref: credential })
    return response.result.ok
  } catch {
    return false
  }
}

/** Write a fresh secret first, then atomically point safe profile metadata at it. */
export async function saveProviderProfile(
  api: SettingsCardApi,
  draft: ProviderProfileDraft,
  options: {
    readonly revision: number
    readonly currentDefault?: string
    readonly existingProfileIds?: readonly string[]
    readonly currentProfile?: VisionBridgeProviderProfile
    readonly disabledProfiles?: readonly string[]
    /** Deterministic test seam; the browser uses crypto.randomUUID(). */
    readonly credentialNonce?: string
  },
): Promise<SaveProviderResult> {
  let prepared: ReturnType<typeof profileFromDraft>
  try {
    const id = draft.id.trim()
    const authMode = draft.authMode
      ?? (options.currentProfile?.protocol === draft.protocol ? options.currentProfile.authMode : undefined)
    const hasApiKey = draft.apiKey.trim().length > 0
    const freshCredential = authMode === 'none' || !hasApiKey
      ? undefined
      : credentialReferenceForProfile(id, options.credentialNonce ?? crypto.randomUUID())
    prepared = profileFromDraft(draft, options.currentProfile, freshCredential)
  } catch (error) {
    return {
      ok: false,
      profileCommitted: false,
      credentialCommitted: false,
      error: error instanceof Error ? error.message : 'invalid-profile',
    }
  }
  let credentialCommitted = false
  if (prepared.apiKey !== undefined && prepared.credential !== undefined) {
    let credentialResponse: Awaited<ReturnType<SettingsCardApi['credentials']['set']>>
    try {
      credentialResponse = await api.credentials.set({ ref: prepared.credential, value: prepared.apiKey })
    } catch {
      return {
        ok: false,
        profileCommitted: false,
        credentialCommitted: false,
        error: 'credential-write-failed',
      }
    }
    if (!credentialResponse.result.ok) {
      return {
        ok: false,
        profileCommitted: false,
        credentialCommitted: false,
        error: 'credential-write-failed',
      }
    }
    credentialCommitted = true
  }
  const ops: Array<
    | { op: 'set'; path: string[]; value: unknown }
    | { op: 'unset'; path: string[] }
  > = [{ op: 'set', path: ['profiles', prepared.id], value: prepared.profile }]
  if (options.disabledProfiles?.includes(prepared.id)) {
    ops.push({
      op: 'set',
      path: ['disabledProfiles'],
      value: options.disabledProfiles.filter(id => id !== prepared.id),
    })
  }
  if (options.currentDefault === undefined && options.existingProfileIds !== undefined) {
    // One profile is implicitly valid at runtime, but persisting that choice is
    // required before a second equal-status profile can pass canonical config validation.
    ops.push({
      op: 'set',
      path: ['defaultProvider'],
      value: options.existingProfileIds[0] ?? prepared.id,
    })
  }
  let profileResponse: Awaited<ReturnType<SettingsCardApi['settings']['mutate']>>
  try {
    profileResponse = await api.settings.mutate({
      ns: VISION_BRIDGE_SETTINGS_NAMESPACE,
      ops,
      expectedRevision: options.revision,
    })
  } catch {
    if (credentialCommitted && prepared.credential !== undefined) {
      const referenced = await committedProfileUsesCredential(api, prepared.id, prepared.credential)
      if (referenced === true) {
        return {
          ok: true,
          profileCommitted: true,
          credentialCommitted: true,
          id: prepared.id,
          profile: prepared.profile,
        }
      }
      if (referenced === false) {
        credentialCommitted = !(await rollbackCredential(api, prepared.credential))
      }
    }
    return { ok: false, profileCommitted: false, credentialCommitted, error: 'settings-write-failed' }
  }
  if (!profileResponse.result.ok) {
    if (credentialCommitted && prepared.credential !== undefined) {
      credentialCommitted = !(await rollbackCredential(api, prepared.credential))
    }
    return {
      ok: false,
      profileCommitted: false,
      credentialCommitted,
      error: 'settings-write-failed',
    }
  }
  return {
    ok: true,
    profileCommitted: true,
    credentialCommitted,
    id: prepared.id,
    profile: prepared.profile,
  }
}

/** Persist one global switch transition without touching any live session. */
export async function setOpenEyesEnabled(
  api: SettingsCardApi,
  enabled: boolean,
  options: {
    readonly revision: number
    readonly currentEnabled: boolean
    readonly history?: readonly VisionBridgeEnablementTransition[]
    readonly now?: number
  },
): Promise<SettingsWriteResult> {
  if (enabled === options.currentEnabled) return { ok: true }
  const history = [...(options.history ?? [{ effectiveAt: 0, enabled: options.currentEnabled }])]
  const lastAt = history.at(-1)?.effectiveAt ?? 0
  const effectiveAt = Math.max(options.now ?? Date.now(), lastAt + 1)
  try {
    const response = await api.settings.mutate({
      ns: VISION_BRIDGE_SETTINGS_NAMESPACE,
      ops: [
        { op: 'set', path: ['enabled'], value: enabled },
        { op: 'set', path: ['enablementHistory'], value: [...history, { effectiveAt, enabled }] },
      ],
      expectedRevision: options.revision,
    })
    return response.result.ok ? { ok: true } : { ok: false, error: response.result.error.message }
  } catch {
    return { ok: false, error: 'settings-write-failed' }
  }
}

/** Persist every prompt-only visual preference in one atomic settings mutation. */
export async function setOpenEyesPreferences(
  api: SettingsCardApi,
  preferences: {
    readonly visualAnalysis: VisualAnalysisMode
    readonly focusAreas: readonly VisualFocusArea[] | readonly string[]
    readonly preference: string
  },
  revision: number,
): Promise<SettingsWriteResult> {
  let visualAnalysis: VisualAnalysisMode
  let focusAreas: VisualFocusArea[]
  try {
    visualAnalysis = normalizeVisualAnalysis(preferences.visualAnalysis)
    focusAreas = normalizeFocusAreas(preferences.focusAreas)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid-visual-preferences' }
  }
  const preference = preferences.preference.trim()
  if (countPreferenceUnits(preference) > MAX_CUSTOM_PREFERENCE_UNITS) {
    return { ok: false, error: 'preference-too-long' }
  }
  try {
    const response = await api.settings.mutate({
      ns: VISION_BRIDGE_SETTINGS_NAMESPACE,
      ops: [
        { op: 'set', path: ['visualAnalysis'], value: visualAnalysis },
        { op: 'set', path: ['focusAreas'], value: focusAreas },
        { op: 'set', path: ['preference'], value: preference },
      ],
      expectedRevision: revision,
    })
    return response.result.ok ? { ok: true } : { ok: false, error: response.result.error.message }
  } catch {
    return { ok: false, error: 'settings-write-failed' }
  }
}

export async function selectDefaultProvider(
  api: SettingsCardApi,
  profileId: string,
  revision: number,
): Promise<SettingsWriteResult> {
  try {
    const response = await api.settings.mutate({
      ns: VISION_BRIDGE_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: ['defaultProvider'], value: profileId }],
      expectedRevision: revision,
    })
    return response.result.ok ? { ok: true } : { ok: false, error: response.result.error.message }
  } catch {
    return { ok: false, error: 'settings-write-failed' }
  }
}

export async function deleteProviderProfile(
  api: SettingsCardApi,
  profileId: string,
  options: {
    readonly revision: number
    readonly currentDefault: string | undefined
    readonly remainingIds: readonly string[]
    readonly disabledProfiles: readonly string[]
  },
): Promise<SettingsWriteResult> {
  const ops: Array<
    | { op: 'set'; path: string[]; value: unknown }
    | { op: 'unset'; path: string[] }
  > = [
    { op: 'unset', path: ['profiles', profileId] },
    {
      op: 'set',
      path: ['disabledProfiles'],
      value: [...new Set([...options.disabledProfiles, profileId])],
    },
  ]
  if (options.currentDefault === profileId) {
    const next = options.remainingIds[0]
    if (next === undefined) ops.push({ op: 'unset', path: ['defaultProvider'] })
    else ops.push({ op: 'set', path: ['defaultProvider'], value: next })
  }
  try {
    const response = await api.settings.mutate({
      ns: VISION_BRIDGE_SETTINGS_NAMESPACE,
      ops,
      expectedRevision: options.revision,
    })
    return response.result.ok ? { ok: true } : { ok: false, error: response.result.error.message }
  } catch {
    return { ok: false, error: 'settings-write-failed' }
  }
}
