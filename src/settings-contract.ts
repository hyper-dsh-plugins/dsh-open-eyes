import type { AuthMode, Protocol } from './provider-contract.js'
import type { VisualAnalysisMode, VisualFocusArea } from './visual-preferences.js'

/** Browser-safe settings namespace; the Host brands the same literal. */
export const VISION_BRIDGE_SETTINGS_NAMESPACE = 'dsh-open-eyes'
export const MAX_PREFERENCE_CHARS = 2_000

/** Browser-safe, editable subset of one provider. Secrets remain in ctx.credentials. */
export interface VisionBridgeProviderProfile {
  /** Optional user-facing remark; the immutable profile id remains the storage key. */
  displayName?: string
  protocol: Protocol
  baseUrl: string
  model: string
  endpointPath?: string
  authMode?: AuthMode
  credential?: string
  maxOutputTokens?: number
  chatMaxTokensField?: 'max_tokens' | 'max_completion_tokens'
  anthropicVersion?: string
}

/** Durable provider schemes exposed to the Settings UI. */
export interface VisionBridgeSettings {
  /** Global choice sampled once when a session starts. */
  enabled?: boolean
  /** Optional live preference added only to delegated visual-analysis prompts. */
  preference?: string
  /** Optional prompt preset; default is an exact no-op. */
  visualAnalysis?: VisualAnalysisMode
  /** Optional canonical focus presets appended only to delegated prompts. */
  focusAreas?: VisualFocusArea[]
  /** Browser-safe switch history used to restore a resumed session's original choice. */
  enablementHistory?: VisionBridgeEnablementTransition[]
  profiles: Record<string, VisionBridgeProviderProfile>
  defaultProvider?: string
  /** Source-neutral tombstones make every effective profile equally removable. */
  disabledProfiles?: string[]
}

export interface VisionBridgeEnablementTransition {
  effectiveAt: number
  enabled: boolean
}

function credentialReferenceSegment(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('')
}

/**
 * Derive a portable credential slot without normalizing distinct profile ids
 * onto the same environment-variable name. A nonce creates a fresh slot for
 * key rotation, so settings never point a changed endpoint at the old secret.
 */
export function credentialReferenceForProfile(profileId: string, nonce?: string): string {
  const profile = credentialReferenceSegment(profileId)
  const revision = nonce === undefined ? '' : `_R${credentialReferenceSegment(nonce)}`
  return `DSH_OPEN_EYES_P${profile}${revision}_API_KEY`
}

/** A distinct temporary slot for an editor's not-yet-saved model lookup. */
export function modelDiscoveryCredentialReferenceForProfile(profileId: string, nonce: string): string {
  return credentialReferenceForProfile(profileId, `model-discovery-${nonce}`)
}

export function isModelDiscoveryCredentialReferenceForProfile(profileId: string, ref: string): boolean {
  const prefix = credentialReferenceForProfile(profileId, 'model-discovery-').slice(0, -'_API_KEY'.length)
  return ref.startsWith(prefix) && ref.endsWith('_API_KEY') && ref.length > prefix.length + '_API_KEY'.length
}
