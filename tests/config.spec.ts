import { describe, expect, it } from 'vitest'
import { Config, validateConfig } from '../src/config.js'

function parse(input: unknown) {
  return validateConfig(Config(input as never))
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'primary',
    protocol: 'openai-responses',
    baseUrl: 'https://api.example.test/v1',
    model: 'vision-model',
    credential: 'VISION_API_KEY',
    ...overrides,
  }
}

describe('configuration', () => {
  it('accepts an empty, dormant provider list and applies defaults', () => {
    const config = parse({})
    expect(config.providers).toEqual([])
    expect(config.enabled).toBe(true)
    expect(config.preference).toBe('')
    expect(config.visualAnalysis).toBe('default')
    expect(config.focusAreas).toEqual([])
    expect(config.defaultProvider).toBeUndefined()
    expect(config.timeoutMs).toBe(300_000)
    expect(config.maxImageBytes).toBe(10 * 1024 * 1024)
    expect(config.maxRetries).toBe(2)
    expect(config.allowRemoteUrls).toBe(false)
  })

  it('accepts a statically disabled starting state for newly created sessions', () => {
    expect(parse({ enabled: false }).enabled).toBe(false)
  })

  it('accepts a concise global visual-analysis preference and trims it', () => {
    expect(parse({ preference: '  Focus on visible error codes.  ' }).preference).toBe(
      'Focus on visible error codes.',
    )
    expect(() => parse({ preference: 'x'.repeat(2_001) })).toThrow(/preference/)
  })

  it('normalizes the protocol-neutral visual-analysis presets', () => {
    expect(parse({
      visualAnalysis: 'deep',
      focusAreas: ['details', 'text', 'details'],
    } as never)).toMatchObject({
      visualAnalysis: 'deep',
      focusAreas: ['text', 'details'],
    })
    expect(() => parse({ visualAnalysis: 'balanced' } as never)).toThrow(/visualAnalysis/)
    expect(() => parse({ focusAreas: ['unknown'] } as never)).toThrow(/focusAreas/)
  })

  it('automatically selects the only provider and resolves protocol defaults', () => {
    const config = parse({ providers: [provider()] })
    expect(config.defaultProvider).toBe('primary')
    expect(config.providers[0]).toMatchObject({
      authMode: 'bearer',
      endpointPath: '/responses',
    })
  })

  it('requires a valid default when multiple providers exist', () => {
    expect(() => parse({ providers: [provider(), provider({ id: 'other' })] })).toThrow(/defaultProvider/)
    expect(() => parse({ providers: [provider(), provider({ id: 'other' })], defaultProvider: 'missing' })).toThrow(
      /defaultProvider/,
    )
  })

  it('rejects duplicate and unsafe ids', () => {
    expect(() => parse({ providers: [provider(), provider()] })).toThrow(/unique/)
    expect(() => parse({ providers: [provider({ id: '../unsafe' })] })).toThrow(/safe/)
  })

  it('rejects an unsupported protocol even if schema validation is bypassed', () => {
    expect(() =>
      validateConfig({ ...Config({}), providers: [provider({ protocol: 'openai-compatible' })] } as never),
    ).toThrow(/protocol/)
  })

  it('rejects non-loopback insecure HTTP and accepts loopback HTTP', () => {
    expect(() => parse({ providers: [provider({ baseUrl: 'http://example.test/v1' })] })).toThrow(/insecure HTTP/)
    expect(parse({ providers: [provider({ baseUrl: 'http://127.0.0.1:8080/v1' })] }).providers[0]?.baseUrl).toBe(
      'http://127.0.0.1:8080/v1',
    )
    expect(parse({ providers: [provider({ baseUrl: 'http://localhost:8080/v1' })] }).providers).toHaveLength(1)
    expect(parse({ providers: [provider({ baseUrl: 'http://[::1]:8080/v1' })] }).providers).toHaveLength(1)
  })

  it('allows explicitly opted-in non-loopback HTTP', () => {
    expect(parse({ allowInsecureHttp: true, providers: [provider({ baseUrl: 'http://example.test' })] }).providers).toHaveLength(
      1,
    )
  })

  it('enforces auth and credential combinations', () => {
    expect(() => parse({ providers: [provider({ credential: undefined })] })).toThrow(/credential/i)
    expect(() => parse({ providers: [provider({ authMode: 'none', credential: 'VISION_API_KEY' })] })).toThrow(/must not/)
    expect(parse({ providers: [provider({ authMode: 'none', credential: undefined })] }).providers[0]?.credential).toBeUndefined()
  })

  it.each(['authorization', 'Proxy-Authorization', 'X-API-Key', 'host', 'content-length', 'connection', 'transfer-encoding'])(
    'rejects reserved header %s',
    (header) => {
      expect(() => parse({ providers: [provider({ headers: { [header]: 'do-not-echo' } })] })).toThrow(/header/)
    },
  )

  it.each([
    ['openai-responses', 'input'],
    ['openai-chat-completions', 'messages'],
    ['anthropic-messages', 'system'],
  ])('rejects adapter-owned extraBody field for %s', (protocol, field) => {
    expect(() => parse({ providers: [provider({ protocol, extraBody: { [field]: 'override' }, maxOutputTokens: 100 })] })).toThrow(
      /extraBody/,
    )
  })

  it('validates endpoint paths, URLs, model names, and Anthropic max tokens', () => {
    expect(() => parse({ providers: [provider({ endpointPath: 'responses' })] })).toThrow(/endpointPath/)
    expect(() => parse({ providers: [provider({ endpointPath: '/../secret' })] })).toThrow(/endpointPath/)
    expect(() => parse({ providers: [provider({ endpointPath: '/%2f..%2fsecret' })] })).toThrow(/endpointPath/)
    expect(() => parse({ providers: [provider({ endpointPath: '/%5c..%5csecret' })] })).toThrow(/endpointPath/)
    expect(() => parse({ providers: [provider({ baseUrl: 'https://user:password@example.test' })] })).toThrow(/credentials/)
    expect(() => parse({ providers: [provider({ baseUrl: 'https://example.test/#fragment' })] })).toThrow(/fragment/)
    expect(() => parse({ providers: [provider({ model: '   ' })] })).toThrow(/model/)
    expect(() => parse({ providers: [provider({ protocol: 'anthropic-messages' })] })).toThrow(/maxOutputTokens/)
  })

  it('rejects unsafe aggregate local-image limits', () => {
    expect(() => parse({ maxImageBytes: 10 * 1024 * 1024, maxImages: 7 })).toThrow(/aggregate/)
    expect(parse({ maxImageBytes: 8 * 1024 * 1024, maxImages: 8 }).maxImages).toBe(8)
  })

  it('normalizes and deduplicates additional roots without mutating input', () => {
    const roots = ['/tmp/a/../images', '/tmp/images', '/tmp/other/']
    const config = parse({ extraAllowedRoots: roots })
    expect(config.extraAllowedRoots).toEqual(['/tmp/images', '/tmp/other/'])
    expect(roots).toEqual(['/tmp/a/../images', '/tmp/images', '/tmp/other/'])
  })

  it('does not include rejected header values in configuration errors', () => {
    const secret = 'sk-sensitive-value'
    expect(() => parse({ providers: [provider({ headers: { Authorization: secret } })] })).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    )
  })
})
