import { describe, expect, it, vi } from 'vitest'
import {
  deleteProviderProfile,
  prepareProviderModelDiscovery,
  requestProviderValidation,
  saveProviderProfile,
  selectDefaultProvider,
  setOpenEyesEnabled,
  type ProviderProfileDraft,
  type SettingsCardApi,
} from '../src/client/settings-card.js'
import * as settingsCardModule from '../src/client/settings-card.js'
import {
  credentialReferenceForProfile,
  modelDiscoveryCredentialReferenceForProfile,
} from '../src/settings.js'

function ok<T>(value: T) {
  return { ok: true as const, value }
}

function rejected(message: string) {
  return { ok: false as const, error: { code: 'rejected', message } }
}

interface ApiOverrides {
  readonly settingsMutate?: SettingsCardApi['settings']['mutate']
  readonly settingsDescribe?: SettingsCardApi['settings']['describe']
  readonly credentialsDescribe?: SettingsCardApi['credentials']['describe']
  readonly credentialsSet?: SettingsCardApi['credentials']['set']
  readonly credentialsUnset?: SettingsCardApi['credentials']['unset']
}

function api(overrides: ApiOverrides = {}) {
  const settingsMutate = vi.fn(overrides.settingsMutate ?? (async () => ok({})))
  const settingsDescribe = vi.fn(overrides.settingsDescribe ?? (async () => ok({
    writable: true,
    hasDocument: true,
    namespaces: [{ ns: 'dsh-open-eyes', value: { profiles: {} } }],
  })))
  const credentialsDescribe = vi.fn(overrides.credentialsDescribe ?? (async () => ok({})))
  const credentialsSet = vi.fn(overrides.credentialsSet ?? (async () => ok({})))
  const credentialsUnset = vi.fn(overrides.credentialsUnset ?? (async () => ok({})))
  const client = {
    settings: { mutate: settingsMutate, describe: settingsDescribe },
    credentials: {
      describe: credentialsDescribe,
      set: credentialsSet,
      unset: credentialsUnset,
    },
  } satisfies SettingsCardApi
  return { client, settingsMutate, settingsDescribe, credentialsDescribe, credentialsSet, credentialsUnset }
}

const draft: ProviderProfileDraft = {
  id: 'primary',
  protocol: 'openai-responses',
  baseUrl: 'https://vision.example.test/v1',
  model: 'vision-model',
  apiKey: 'sk-browser-only',
}

describe('provider settings card writes', () => {
  it('stores all global visual preferences atomically without touching providers or the default', async () => {
    const setPreferences = (settingsCardModule as typeof settingsCardModule & {
      setOpenEyesPreferences?: (
        api: SettingsCardApi,
        preferences: {
          visualAnalysis: 'default' | 'efficient' | 'deep'
          focusAreas: readonly string[]
          preference: string
        },
        revision: number,
      ) => Promise<{ readonly ok: boolean }>
    }).setOpenEyesPreferences
    expect(setPreferences).toBeTypeOf('function')
    if (setPreferences === undefined) return
    const { client, settingsMutate } = api()

    await expect(setPreferences(client, {
      visualAnalysis: 'deep',
      focusAreas: ['details', 'text', 'details'],
      preference: '  Focus on serial numbers.  ',
    }, 8)).resolves.toEqual({ ok: true })
    expect(settingsMutate).toHaveBeenCalledWith(
      'dsh-open-eyes',
      [
        { op: 'set', path: ['visualAnalysis'], value: 'deep' },
        { op: 'set', path: ['focusAreas'], value: ['text', 'details'] },
        { op: 'set', path: ['preference'], value: 'Focus on serial numbers.' },
      ],
      8,
    )
  })

  it('counts Chinese characters and contiguous English words as equal preference units', () => {
    const count = (settingsCardModule as typeof settingsCardModule & {
      countPreferenceUnits?: (value: string) => number
    }).countPreferenceUnits
    expect(count).toBeTypeOf('function')
    if (count === undefined) return
    expect(count('重点关注错误码')).toBe(7)
    expect(count('focus on exact error codes')).toBe(5)
    expect(count('错误 code 42')).toBe(5)
    expect(count('2048')).toBe(4)
  })

  it('rejects saving an over-limit custom supplement without mutating settings', async () => {
    const setPreferences = (settingsCardModule as typeof settingsCardModule & {
      setOpenEyesPreferences?: (
        api: SettingsCardApi,
        preferences: {
          visualAnalysis: 'default' | 'efficient' | 'deep'
          focusAreas: readonly string[]
          preference: string
        },
        revision: number,
      ) => Promise<{ readonly ok: boolean; readonly error?: string }>
    }).setOpenEyesPreferences
    expect(setPreferences).toBeTypeOf('function')
    if (setPreferences === undefined) return
    const { client, settingsMutate } = api()

    await expect(setPreferences(client, {
      visualAnalysis: 'default',
      focusAreas: [],
      preference: '一'.repeat(51),
    }, 8)).resolves.toEqual({ ok: false, error: 'preference-too-long' })
    expect(settingsMutate).not.toHaveBeenCalled()
  })

  it('records an enable switch transition without changing any provider or default', async () => {
    const { client, settingsMutate } = api()
    await expect(setOpenEyesEnabled(client, false, {
      revision: 9,
      currentEnabled: true,
      history: [{ effectiveAt: 0, enabled: true }],
      now: 100,
    })).resolves.toEqual({ ok: true })
    expect(settingsMutate).toHaveBeenCalledWith(
      'dsh-open-eyes',
      [
        { op: 'set', path: ['enabled'], value: false },
        {
          op: 'set',
          path: ['enablementHistory'],
          value: [
            { effectiveAt: 0, enabled: true },
            { effectiveAt: 100, enabled: false },
          ],
        },
      ],
      9,
    )
  })

  it('stores a trimmed optional display name independently of the scheme id', async () => {
    const { client, settingsMutate } = api()
    const result = await saveProviderProfile(client, {
      ...draft,
      displayName: '  Production Vision  ',
    }, { revision: 2, credentialNonce: 'display-name' })
    expect(result).toMatchObject({
      ok: true,
      id: 'primary',
      profile: { displayName: 'Production Vision', model: 'vision-model' },
    })
    expect(settingsMutate.mock.calls[0]?.[1]?.[0]).toMatchObject({
      value: { displayName: 'Production Vision', model: 'vision-model' },
    })
  })


  it('stages an unsaved key in DSH credentials and requests models without sending the secret', async () => {
    const requestModels = (settingsCardModule as typeof settingsCardModule & {
      requestProviderModels?: (
        draft: {
          readonly providerId: string
          readonly protocol: string
          readonly baseUrl: string
          readonly credential?: string
        },
        fetcher: typeof fetch,
      ) => Promise<{ readonly ok: true; readonly models: readonly string[] }>
    }).requestProviderModels
    expect(requestModels).toBeTypeOf('function')
    if (requestModels === undefined) return
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      models: ['vision-b', 'vision-a'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const { client, credentialsSet } = api()
    const prepared = await prepareProviderModelDiscovery(client, draft, undefined, 'lookup-1')
    expect(prepared).toEqual({
      ok: true,
      draft: {
        providerId: 'primary',
        protocol: 'openai-responses',
        baseUrl: 'https://vision.example.test/v1',
        credential: modelDiscoveryCredentialReferenceForProfile('primary', 'lookup-1'),
      },
      stagedCredential: modelDiscoveryCredentialReferenceForProfile('primary', 'lookup-1'),
    })
    expect(credentialsSet).toHaveBeenCalledWith(
      modelDiscoveryCredentialReferenceForProfile('primary', 'lookup-1'),
      'sk-browser-only',
    )

    if (!prepared.ok) return
    await expect(requestModels(prepared.draft, fetcher)).resolves.toEqual({
      ok: true,
      models: ['vision-b', 'vision-a'],
    })
    expect(fetcher).toHaveBeenCalledWith('/vision-bridge/v1/provider-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prepared.draft),
      credentials: 'same-origin',
      redirect: 'error',
    })
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('apiKey')
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('sk-browser-only')
  })

  it('requests validation with only the saved scheme id', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(requestProviderValidation('primary', fetcher)).resolves.toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledWith('/vision-bridge/v1/provider-validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'primary' }),
      credentials: 'same-origin',
      redirect: 'error',
    })
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('apiKey')
  })

  it('returns only a stable validation error code from a failed request', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: 'VISION_CREDENTIAL_MISSING',
      detail: 'must not cross the client seam',
    }), { status: 424, headers: { 'content-type': 'application/json' } }))

    await expect(requestProviderValidation('primary', fetcher))
      .resolves.toEqual({ ok: false, error: 'VISION_CREDENTIAL_MISSING' })
  })

  it('admits only a safe structured validation diagnostic from the server', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: 'VISION_UPSTREAM_HTTP',
      diagnostic: {
        reason: 'http',
        httpStatus: 404,
        upstreamBody: 'must not cross the client seam',
      },
      detail: 'must not cross the client seam',
    }), { status: 502, headers: { 'content-type': 'application/json' } }))

    await expect(requestProviderValidation('primary', fetcher)).resolves.toEqual({
      ok: false,
      error: 'VISION_UPSTREAM_HTTP',
      diagnostic: { reason: 'http', httpStatus: 404 },
    })
  })

  it('stores the exact API key before atomically pointing profile metadata at its fresh reference', async () => {
    const { client, settingsMutate, credentialsSet } = api()
    const order: string[] = []
    credentialsSet.mockImplementation(async () => {
      order.push('credential')
      return ok({})
    })
    settingsMutate.mockImplementation(async () => {
      order.push('settings')
      return ok({})
    })
    const credential = credentialReferenceForProfile('primary', 'save-1')

    const result = await saveProviderProfile(client, { ...draft, apiKey: '  sk-browser-only\n' }, {
      revision: 7,
      credentialNonce: 'save-1',
    })

    expect(result).toEqual({
      ok: true,
      profileCommitted: true,
      credentialCommitted: true,
      id: 'primary',
      profile: {
        protocol: 'openai-responses',
        baseUrl: 'https://vision.example.test/v1',
        model: 'vision-model',
        credential,
      },
    })
    expect(order).toEqual(['credential', 'settings'])
    expect(client.settings.mutate).toHaveBeenCalledWith(
      'dsh-open-eyes',
      [
        {
          op: 'set',
          path: ['profiles', 'primary'],
          value: {
            protocol: 'openai-responses',
            baseUrl: 'https://vision.example.test/v1',
            model: 'vision-model',
            credential,
          },
        },
      ],
      7,
    )
    expect(JSON.stringify(settingsMutate.mock.calls)).not.toContain('sk-browser-only')
    expect(credentialsSet).toHaveBeenCalledWith(credential, '  sk-browser-only\n')
  })

  it('initializes the first user-created scheme as default even when the checkbox is left clear', async () => {
    const { client, settingsMutate } = api()

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      existingProfileIds: [],
      credentialNonce: 'first-scheme',
    })

    expect(result.ok).toBe(true)
    expect(settingsMutate.mock.calls[0]?.[1]).toContainEqual({
      op: 'set',
      path: ['defaultProvider'],
      value: 'primary',
    })
  })

  it('preserves the existing implicit first scheme when repairing an old missing default', async () => {
    const { client, settingsMutate } = api()

    await saveProviderProfile(client, { ...draft, id: 'beta' }, {
      revision: 2,
      existingProfileIds: ['alpha'],
      credentialNonce: 'second-scheme',
    })

    expect(settingsMutate.mock.calls[0]?.[1]).toContainEqual({
      op: 'set',
      path: ['defaultProvider'],
      value: 'alpha',
    })
  })

  it('adds the required Anthropic token cap without exposing an advanced form field', async () => {
    const { client, settingsMutate } = api()
    await saveProviderProfile(client, {
      ...draft,
      id: 'anthropic',
      protocol: 'anthropic-messages',
    }, { revision: 2, credentialNonce: 'anthropic-save' })

    expect(settingsMutate.mock.calls[0]?.[1]).toMatchObject([{
        value: expect.objectContaining({ maxOutputTokens: 4_096 }),
      }])
  })

  it('does not write a credential when editing with a blank key', async () => {
    const { client, settingsMutate, credentialsSet } = api()
    await saveProviderProfile(client, {
      ...draft,
      apiKey: '',
      credential: 'EXISTING_VISION_KEY',
    }, { revision: 3 })

    expect(credentialsSet).not.toHaveBeenCalled()
    expect(settingsMutate.mock.calls[0]?.[1]).toMatchObject([
      { value: expect.objectContaining({ credential: 'EXISTING_VISION_KEY' }) },
    ])
  })

  it('preserves safe advanced fields that the basic form does not expose', async () => {
    const { client, settingsMutate } = api()

    await saveProviderProfile(client, { ...draft, apiKey: '', credential: 'EXISTING_VISION_KEY' }, {
      revision: 4,
      currentProfile: {
        protocol: 'openai-responses',
        baseUrl: 'https://old.example.test/v1',
        model: 'old-model',
        endpointPath: '/responses',
        maxOutputTokens: 8_192,
      },
    })

    expect(settingsMutate.mock.calls[0]?.[1]).toMatchObject([{
        value: expect.objectContaining({
          endpointPath: '/responses',
          maxOutputTokens: 8_192,
          baseUrl: 'https://vision.example.test/v1',
          model: 'vision-model',
        }),
      }])
  })

  it('rolls back the fresh credential when metadata is explicitly rejected', async () => {
    const { client, credentialsSet, credentialsUnset } = api({
      settingsMutate: async () => rejected('profile invalid'),
    })
    const credential = credentialReferenceForProfile('primary', 'rejected-profile')

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'rejected-profile',
    })

    expect(result).toEqual({
      ok: false,
      profileCommitted: false,
      credentialCommitted: false,
      error: 'settings-write-failed',
    })
    expect(credentialsSet).toHaveBeenCalledOnce()
    expect(credentialsUnset).toHaveBeenCalledWith(credential)
  })

  it('reconciles a thrown metadata call before rolling back its fresh credential', async () => {
    const { client, credentialsUnset } = api({
      settingsMutate: async () => { throw new Error('connection lost') },
    })
    const credential = credentialReferenceForProfile('primary', 'thrown-profile')

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'thrown-profile',
    })

    expect(result).toEqual({
      ok: false,
      profileCommitted: false,
      credentialCommitted: false,
      error: 'settings-write-failed',
    })
    expect(credentialsUnset).toHaveBeenCalledWith(credential)
  })

  it('keeps a fresh credential when reconciliation proves the thrown metadata call committed', async () => {
    const credential = credentialReferenceForProfile('primary', 'committed-profile')
    const { client, credentialsUnset } = api({
      settingsMutate: async () => { throw new Error('response lost') },
      settingsDescribe: async () => ok({
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'dsh-open-eyes',
          value: { profiles: { primary: { credential } } },
        }],
      }),
    })

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'committed-profile',
    })

    expect(result).toEqual({
      ok: true,
      profileCommitted: true,
      credentialCommitted: true,
      id: 'primary',
      profile: {
        protocol: 'openai-responses',
        baseUrl: 'https://vision.example.test/v1',
        model: 'vision-model',
        credential,
      },
    })
    expect(credentialsUnset).not.toHaveBeenCalled()
  })

  it('reports a still-committed credential if rollback is rejected without exposing provider errors', async () => {
    const { client } = api({
      settingsMutate: async () => rejected('profile invalid'),
      credentialsUnset: async () => rejected('backend detail'),
    })

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'rollback-rejected',
    })

    expect(result).toEqual({
      ok: false,
      profileCommitted: false,
      credentialCommitted: true,
      error: 'settings-write-failed',
    })
  })

  it('never changes profile metadata when the credential write fails', async () => {
    const { client, settingsMutate } = api({
      credentialsSet: async () => rejected('credential is shadowed'),
    })

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'rejected-credential',
    })

    expect(result).toEqual({
      ok: false,
      profileCommitted: false,
      credentialCommitted: false,
      error: 'credential-write-failed',
    })
    expect(settingsMutate).not.toHaveBeenCalled()
  })

  it('rotates away from an existing credential when an edited profile supplies a new key', async () => {
    const { client, settingsMutate, credentialsSet } = api()
    const fresh = credentialReferenceForProfile('primary', 'rotation-1')

    await saveProviderProfile(client, {
      ...draft,
      baseUrl: 'https://new-endpoint.example.test/v1',
      apiKey: 'new-key',
      credential: 'EXISTING_VISION_KEY',
    }, {
      revision: 5,
      credentialNonce: 'rotation-1',
      currentProfile: {
        protocol: 'openai-responses',
        baseUrl: 'https://old-endpoint.example.test/v1',
        model: 'old-model',
        credential: 'EXISTING_VISION_KEY',
      },
    })

    expect(credentialsSet).toHaveBeenCalledWith(fresh, 'new-key')
    expect(settingsMutate.mock.calls[0]?.[1]?.[0]).toMatchObject({
      value: expect.objectContaining({
        baseUrl: 'https://new-endpoint.example.test/v1',
        credential: fresh,
      }),
    })
  })

  it('never reflects a rejected credential error that could contain the submitted secret', async () => {
    const { client } = api({
      credentialsSet: async () => rejected('backend echoed sk-browser-only'),
    })

    const result = await saveProviderProfile(client, draft, {
      revision: 1,
      credentialNonce: 'redaction-check',
    })

    expect(JSON.stringify(result)).not.toContain('sk-browser-only')
  })

  it('rejects endpoint query strings before settings or credentials can persist them', async () => {
    const { client, settingsMutate, credentialsSet } = api()

    const result = await saveProviderProfile(client, {
      ...draft,
      baseUrl: 'https://vision.example.test/v1?key=must-not-persist',
    }, { revision: 1, credentialNonce: 'query-endpoint' })

    expect(result).toEqual({
      ok: false,
      profileCommitted: false,
      credentialCommitted: false,
      error: 'invalid-base-url',
    })
    expect(settingsMutate).not.toHaveBeenCalled()
    expect(credentialsSet).not.toHaveBeenCalled()
  })

  it('accepts a complete protocol endpoint without appending that endpoint twice', async () => {
    const { client, settingsMutate } = api()

    const result = await saveProviderProfile(client, {
      ...draft,
      protocol: 'openai-chat-completions',
      baseUrl: 'https://gateway.example.test/zen/v1/chat/completions',
    }, { revision: 1, credentialNonce: 'complete-endpoint' })

    expect(result.ok).toBe(true)
    expect(settingsMutate.mock.calls[0]?.[1]?.[0]).toEqual({
      op: 'set',
      path: ['profiles', 'primary'],
      value: {
        protocol: 'openai-chat-completions',
        baseUrl: 'https://gateway.example.test/zen/v1',
        endpointPath: '/chat/completions',
        model: 'vision-model',
        credential: credentialReferenceForProfile('primary', 'complete-endpoint'),
      },
    })
  })

  it('selects a default and deletes a user-created default atomically', async () => {
    const { client, settingsMutate } = api()

    await selectDefaultProvider(client, 'backup', 5)
    await deleteProviderProfile(client, 'backup', {
      revision: 6,
      currentDefault: 'backup',
      remainingIds: ['primary'],
      disabledProfiles: [],
    })

    expect(settingsMutate).toHaveBeenNthCalledWith(
      1,
      'dsh-open-eyes',
      [{ op: 'set', path: ['defaultProvider'], value: 'backup' }],
      5,
    )
    expect(settingsMutate).toHaveBeenNthCalledWith(
      2,
      'dsh-open-eyes',
      [
        { op: 'unset', path: ['profiles', 'backup'] },
        { op: 'set', path: ['disabledProfiles'], value: ['backup'] },
        { op: 'set', path: ['defaultProvider'], value: 'primary' },
      ],
      6,
    )
  })

  it('deletes every profile through the same source-neutral operation', async () => {
    const { client, settingsMutate } = api()

    const result = await deleteProviderProfile(client, 'primary', {
      revision: 1,
      currentDefault: 'primary',
      remainingIds: [],
      disabledProfiles: [],
    })

    expect(result).toEqual({ ok: true })
    expect(settingsMutate).toHaveBeenCalledWith(
      'dsh-open-eyes',
      [
        { op: 'unset', path: ['profiles', 'primary'] },
        { op: 'set', path: ['disabledProfiles'], value: ['primary'] },
        { op: 'unset', path: ['defaultProvider'] },
      ],
      1,
    )
  })
})
