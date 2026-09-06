import z from '@deepseek-ai/schemastery'
import {
  AUTH_MODES,
  PROTOCOLS,
  validateConfig,
  type Config,
  type ResolvedConfig,
} from './config.js'
import {
  VISION_BRIDGE_SETTINGS_NAMESPACE as VISION_BRIDGE_SETTINGS_NAMESPACE_NAME,
  MAX_PREFERENCE_CHARS,
  type VisionBridgeProviderProfile,
  type VisionBridgeSettings,
} from './settings-contract.js'
import { VISUAL_ANALYSIS_MODES, VISUAL_FOCUS_AREAS } from './visual-preferences.js'

/** Settings namespace paired with the card in Settings → Plugins. */
export const VISION_BRIDGE_SETTINGS_NAMESPACE = VISION_BRIDGE_SETTINGS_NAMESPACE_NAME

const ProviderProfileSchema: z<VisionBridgeProviderProfile> = z.object({
  displayName: z.string().max(120),
  protocol: z.union(PROTOCOLS.map(value => z.const(value))).required(),
  baseUrl: z.string().required(),
  model: z.string().required(),
  endpointPath: z.string(),
  authMode: z.union(AUTH_MODES.map(value => z.const(value))),
  // The browser may see this reference name and configured state, never the value.
  credential: z.string().role('credential-ref'),
  maxOutputTokens: z.natural(),
  chatMaxTokensField: z.union([z.const('max_tokens'), z.const('max_completion_tokens')]),
  anthropicVersion: z.string(),
})

const EnablementTransitionSchema = z.object({
  effectiveAt: z.natural().required(),
  enabled: z.boolean().required(),
})

export const VisionBridgeSettingsSchema: z<VisionBridgeSettings> = z.object({
  enabled: z.boolean().default(true),
  preference: z.string().max(MAX_PREFERENCE_CHARS).default(''),
  visualAnalysis: z.union(VISUAL_ANALYSIS_MODES.map(value => z.const(value))).default('default'),
  focusAreas: z.array(z.union(VISUAL_FOCUS_AREAS.map(value => z.const(value)))).default([]),
  enablementHistory: z.array(EnablementTransitionSchema).default([{ effectiveAt: 0, enabled: true }]),
  profiles: z.dict(ProviderProfileSchema).default({}),
  defaultProvider: z.string(),
  disabledProfiles: z.array(z.string()),
})

/** Project Cordis config into the redaction-safe composition layer served to the browser. */
export function settingsBaseFromConfig(entry: Config): VisionBridgeSettings {
  const profiles: Record<string, VisionBridgeProviderProfile> = {}
  for (const provider of entry.providers) {
    profiles[provider.id] = {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
      ...(provider.endpointPath === undefined ? {} : { endpointPath: provider.endpointPath }),
      ...(provider.authMode === undefined ? {} : { authMode: provider.authMode }),
      ...(provider.credential === undefined ? {} : { credential: provider.credential }),
      ...(provider.maxOutputTokens === undefined ? {} : { maxOutputTokens: provider.maxOutputTokens }),
      ...(provider.chatMaxTokensField === undefined ? {} : { chatMaxTokensField: provider.chatMaxTokensField }),
      ...(provider.anthropicVersion === undefined ? {} : { anthropicVersion: provider.anthropicVersion }),
    }
  }
  const defaultProvider = entry.defaultProvider ?? (entry.providers.length === 1 ? entry.providers[0]?.id : undefined)
  return {
    enabled: entry.enabled,
    preference: entry.preference,
    visualAnalysis: entry.visualAnalysis,
    focusAreas: entry.focusAreas,
    enablementHistory: [{ effectiveAt: 0, enabled: entry.enabled }],
    profiles,
    ...(defaultProvider === undefined ? {} : { defaultProvider }),
  }
}

/** Merge safe Settings overrides over Cordis-only advanced fields, then run the canonical validator. */
export function resolveConfigFromSettings(entry: Config, settings: VisionBridgeSettings): ResolvedConfig {
  const staticProfiles = new Map(entry.providers.map(provider => [provider.id, provider] as const))
  const disabled = new Set(settings.disabledProfiles ?? [])
  const providers = Object.entries(settings.profiles)
    .filter(([id]) => !disabled.has(id))
    .map(([id, profile]) => ({
      ...staticProfiles.get(id),
      ...profile,
      id,
    }))
  const defaultProvider = settings.defaultProvider !== undefined
    && providers.some(provider => provider.id === settings.defaultProvider)
    ? settings.defaultProvider
    : undefined
  const { providers: _providers, defaultProvider: _defaultProvider, ...runtime } = entry
  return validateConfig({
    ...runtime,
    preference: settings.preference ?? entry.preference,
    visualAnalysis: settings.visualAnalysis ?? entry.visualAnalysis,
    focusAreas: settings.focusAreas ?? entry.focusAreas,
    providers,
    ...(defaultProvider === undefined ? {} : { defaultProvider }),
  })
}

export {
  credentialReferenceForProfile,
  isModelDiscoveryCredentialReferenceForProfile,
  modelDiscoveryCredentialReferenceForProfile,
} from './settings-contract.js'
export type { VisionBridgeProviderProfile, VisionBridgeSettings } from './settings-contract.js'
