import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'
import type { ProviderConfig } from '../src/config.js'
import {
  credentialReferenceForProfile,
  resolveConfigFromSettings,
  settingsBaseFromConfig,
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  VisionBridgeSettingsSchema,
} from '../src/settings.js'

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'primary',
    protocol: 'openai-responses',
    baseUrl: 'https://vision.example.test/v1',
    model: 'vision-model',
    credential: 'VISION_API_KEY',
    ...overrides,
  }
}

describe('settings-backed provider profiles', () => {
  it('projects only browser-safe provider metadata and marks credential references', () => {
    const entry = Config({
      providers: [provider({
        headers: { 'x-private-routing-token': 'must-never-reach-browser' },
        extraBody: { private_hint: 'must-never-reach-browser' },
      })],
    })

    const base = settingsBaseFromConfig(entry)

    expect(base).toEqual({
      enabled: true,
      enablementHistory: [{ effectiveAt: 0, enabled: true }],
      preference: '',
      visualAnalysis: 'default',
      focusAreas: [],
      profiles: {
        primary: {
          protocol: 'openai-responses',
          baseUrl: 'https://vision.example.test/v1',
          model: 'vision-model',
          credential: 'VISION_API_KEY',
        },
      },
      defaultProvider: 'primary',
    })
    expect(JSON.stringify(base)).not.toContain('must-never-reach-browser')
    expect(JSON.stringify(VisionBridgeSettingsSchema.toJSON())).toContain('credential-ref')
  })

  it('preserves advanced Cordis-only fields when a profile overrides its basic metadata', () => {
    const entry = Config({
      providers: [provider({
        headers: { 'x-tenant': 'tenant-a' },
        extraBody: { service_tier: 'priority' },
      })],
    })
    const settings = settingsBaseFromConfig(entry)
    settings.profiles.primary = {
      ...settings.profiles.primary!,
      baseUrl: 'https://new.example.test/v1',
      model: 'new-vision-model',
    }

    const resolved = resolveConfigFromSettings(entry, settings)

    expect(resolved.providers[0]).toMatchObject({
      id: 'primary',
      baseUrl: 'https://new.example.test/v1',
      model: 'new-vision-model',
      headers: { 'x-tenant': 'tenant-a' },
      extraBody: { service_tier: 'priority' },
    })
  })

  it('applies the Settings preference live without changing provider selection', () => {
    const entry = Config({ providers: [provider()] })
    const settings = settingsBaseFromConfig(entry)
    settings.preference = '  Focus on charts and legends.  '
    settings.visualAnalysis = 'efficient'
    settings.focusAreas = ['tables', 'interface']

    const resolved = resolveConfigFromSettings(entry, settings)

    expect(resolved.preference).toBe('Focus on charts and legends.')
    expect(resolved.visualAnalysis).toBe('efficient')
    expect(resolved.focusAreas).toEqual(['tables', 'interface'])
    expect(resolved.defaultProvider).toBe('primary')
  })

  it('adds a saved profile and selects it as the default without changing runtime limits', () => {
    const entry = Config({
      providers: [provider()],
      timeoutMs: 12_345,
      maxRetries: 2,
    })
    const settings = settingsBaseFromConfig(entry)
    settings.profiles.backup = {
      protocol: 'anthropic-messages',
      baseUrl: 'https://anthropic.example.test',
      model: 'claude-vision',
      credential: 'DSH_OPEN_EYES_BACKUP_API_KEY',
      maxOutputTokens: 4_096,
    }
    settings.defaultProvider = 'backup'

    const resolved = resolveConfigFromSettings(entry, settings)

    expect(resolved.providers.map(item => item.id)).toEqual(['primary', 'backup'])
    expect(resolved.defaultProvider).toBe('backup')
    expect(resolved.timeoutMs).toBe(12_345)
    expect(resolved.maxRetries).toBe(2)
  })

  it('preserves the dormant empty-provider state', () => {
    const entry = Config({})
    const settings = settingsBaseFromConfig(entry)

    expect(settings).toEqual({
      enabled: true,
      enablementHistory: [{ effectiveAt: 0, enabled: true }],
      preference: '',
      visualAnalysis: 'default',
      focusAreas: [],
      profiles: {},
    })
    expect(resolveConfigFromSettings(entry, settings).providers).toEqual([])
  })

  it('treats every profile equally when a settings user disables a composition entry', () => {
    const entry = Config({ providers: [provider()], defaultProvider: 'primary' })

    const resolved = resolveConfigFromSettings(entry, {
      profiles: settingsBaseFromConfig(entry).profiles,
      defaultProvider: 'primary',
      disabledProfiles: ['primary'],
    })

    expect(resolved.providers).toEqual([])
    expect(resolved.defaultProvider).toBeUndefined()
  })

  it('rejects a missing default, an invalid credential reference, and an incomplete Anthropic profile', () => {
    const entry = Config({})
    expect(() => resolveConfigFromSettings(entry, {
      profiles: {
        first: {
          protocol: 'openai-responses',
          baseUrl: 'https://first.example.test',
          model: 'vision-1',
          credential: 'FIRST_API_KEY',
        },
        second: {
          protocol: 'openai-responses',
          baseUrl: 'https://second.example.test',
          model: 'vision-2',
          credential: 'SECOND_API_KEY',
        },
      },
    })).toThrow(/defaultProvider/)
    expect(() => resolveConfigFromSettings(entry, {
      profiles: {
        bad: {
          protocol: 'openai-responses',
          baseUrl: 'https://bad.example.test',
          model: 'vision',
          credential: 'not a valid ref',
        },
      },
    })).toThrow(/Credential Reference/)
    expect(() => resolveConfigFromSettings(entry, {
      profiles: {
        anthropic: {
          protocol: 'anthropic-messages',
          baseUrl: 'https://anthropic.example.test',
          model: 'vision',
          credential: 'ANTHROPIC_API_KEY',
        },
      },
    })).toThrow(/maxOutputTokens/)
  })

  it('derives portable, collision-free credential references from profile ids', () => {
    expect(credentialReferenceForProfile('my.gateway-v2')).toBe(
      'DSH_OPEN_EYES_P6D792E676174657761792D7632_API_KEY',
    )
    expect(credentialReferenceForProfile('foo-bar')).not.toBe(credentialReferenceForProfile('foo_bar'))
    expect(credentialReferenceForProfile('foo-bar')).not.toBe(credentialReferenceForProfile('foo.bar'))
    expect(credentialReferenceForProfile('foo-bar', 'revision-1')).toBe(
      credentialReferenceForProfile('foo-bar', 'revision-1'),
    )
    expect(credentialReferenceForProfile('foo-bar', 'revision-1')).not.toBe(
      credentialReferenceForProfile('foo-bar', 'revision-2'),
    )
    expect(VISION_BRIDGE_SETTINGS_NAMESPACE).toBe('dsh-open-eyes')
  })
})
