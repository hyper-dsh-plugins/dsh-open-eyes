import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  editButtonPresentation,
  groupProviderEntries,
  toggleProviderEditor,
  providerValidationMessage,
  settingsCardLocales,
} from '../src/client/settings-card-view.js'

describe('Open Eyes settings card chrome', () => {
  it('places an existing editor inside the matching provider group', () => {
    const entries = [
      ['alpha', { model: 'a' }],
      ['beta', { model: 'b' }],
      ['gamma', { model: 'c' }],
    ] as const

    expect(groupProviderEntries(entries, 'beta')).toEqual([
      { id: 'alpha', profile: { model: 'a' }, editing: false },
      { id: 'beta', profile: { model: 'b' }, editing: true },
      { id: 'gamma', profile: { model: 'c' }, editing: false },
    ])
  })

  it('turns the active Edit action into a same-button collapse toggle', () => {
    const profile = {
      protocol: 'openai-responses' as const,
      baseUrl: 'https://vision.example.test/v1',
      model: 'vision-a',
    }
    const opened = toggleProviderEditor(null, 'alpha', profile, false)
    expect(opened?.existingId).toBe('alpha')
    expect(toggleProviderEditor(opened, 'alpha', profile, false)).toBeNull()
    expect(editButtonPresentation(false)).toEqual({ variant: 'outline', label: 'edit' })
    expect(editButtonPresentation(true)).toEqual({ variant: 'primary', label: 'collapseEdit' })
  })

  it('uses the requested localized product name', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain("title: '开放视觉'")
    expect(source).toContain("title: 'Open Eyes'")
  })

  it('uses one new-session enable switch and compact profile summaries', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain("enabled: '启用'")
    expect(source).toContain("enabledHelp: '开关变更仅对新会话生效")
    expect(source).toContain("displayName: '备注名'")
    expect(source).not.toContain("makeDefault: '设为默认方案'")
    expect(source).not.toContain('<Pill active>{t(\'default\')}</Pill>')
    expect(source).not.toContain('profile.protocol} · {profile.model} · {profile.baseUrl}')
  })

  it('never reads a React event from inside a deferred state updater', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/setEditor\([\s\S]{0,240}event\.currentTarget/u)
  })

  it('uses DSH primitives instead of the browser details marker', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain("from '@deepseek-ai/dsh-client-ui-primitives'")
    expect(source).toContain('IconChevronDownOutline14')
    expect(source).toContain("aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}")
    expect(source).not.toContain('<details')
    expect(source).not.toContain('<summary')
  })

  it('uses the native DSH tooltip and question icon for protocol-specific endpoint help', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Tooltip')
    expect(source).toContain('IconQuestionOutline14')
    expect(source).toContain("endpointHelpResponses")
    expect(source).toContain("endpointHelpChatCompletions")
    expect(source).toContain("endpointHelpAnthropicMessages")
  })

  it('uses one native floating validation feedback surface without expanding provider rows', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Toast')
    expect(source).toContain('showValidationToast')
    expect(source).not.toContain('validationStates')
    expect(source).not.toContain('styles.validationStatus')
  })

  it('renders a token-based inset editor, global preference, and multimodal model reminder', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain("preference: '偏好'")
    expect(source).toContain("visualAnalysis: '视觉分析'")
    expect(source).toContain("focusAreas: '关注重点'")
    expect(source).toContain("modelCapabilityHint: '请自行确认所选模型具备多模态能力。'")
    expect(source).toContain("background: 'var(--dsw-alias-bg-module-platform)'")
  })

  it('never renders a collapsed preference summary', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('savedPreferenceSummary')
    expect(source).not.toContain('styles.preferenceSummary')
  })

  it('uses the official danger action semantics for scheme deletion', async () => {
    const source = await readFile(new URL('../src/client/settings-card-view.tsx', import.meta.url), 'utf8')
    expect(source).toContain('dsh-open-eyes-danger-button')
    expect(source).toContain('var(--dsw-alias-state-error-primary)')
    expect(source).toContain('var(--dsw-alias-interactive-bg-hover-danger)')
  })

  it('renders actionable safe diagnostics instead of one generic validation failure', () => {
    const t = (key: keyof typeof settingsCardLocales.zh): string => settingsCardLocales.zh[key]

    expect(providerValidationMessage({
      ok: false,
      error: 'VISION_UPSTREAM_HTTP',
      diagnostic: { reason: 'http', httpStatus: 404 },
    }, t)).toBe('验证失败：上游返回 HTTP 404，请检查地址结尾和模型名称。')
    expect(providerValidationMessage({
      ok: false,
      error: 'VISION_UPSTREAM_PROTOCOL',
      diagnostic: { reason: 'network' },
    }, t)).toContain('域名、端口、TLS')
    expect(providerValidationMessage({
      ok: false,
      error: 'VISION_UPSTREAM_PROTOCOL',
      diagnostic: { reason: 'invalid-json' },
    }, t)).toContain('响应不是 JSON')
  })
})
