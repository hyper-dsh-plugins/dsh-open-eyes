import * as React from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button,
  IconChevronDownOutline14,
  IconQuestionOutline14,
  IconRefreshOutline14,
  Input,
  Menu,
  Toast,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { PROTOCOLS, type Protocol } from '../provider-contract.js'
import {
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  type VisionBridgeProviderProfile,
  type VisionBridgeSettings,
} from '../settings-contract.js'
import {
  MAX_CUSTOM_PREFERENCE_UNITS,
  VISUAL_FOCUS_AREAS,
  countPreferenceUnits,
  type VisualAnalysisMode,
  type VisualFocusArea,
} from '../visual-preferences.js'
import {
  deleteProviderProfile,
  prepareProviderModelDiscovery,
  requestProviderModels,
  requestProviderValidation,
  saveProviderProfile,
  selectDefaultProvider,
  setOpenEyesEnabled,
  setOpenEyesPreferences,
  type ProviderProfileDraft,
  type ProviderValidationResult,
  type SettingsCardApi,
} from './settings-card.js'

export const SETTINGS_CARD_LOCALE_NAMESPACE = `${VISION_BRIDGE_SETTINGS_NAMESPACE}.settings`

export const settingsCardLocales = {
  zh: {
    title: '开放视觉',
    description: '配置视觉模型服务、API 凭据和默认方案。',
    expand: '展开设置',
    collapse: '收起设置',
    loading: '正在读取配置…',
    readOnly: '当前连接不允许修改插件配置。',
    unavailable: '配置连接暂时不可用；已保留最后一次有效内容并切换为只读。',
    enabled: '启用',
    enabledHelpLabel: '查看启用范围说明',
    enabledHelp: '开关变更仅对新会话生效；已有会话继续保持创建时的状态。',
    enabledSaved: '启用设置已保存，将从新会话开始生效。',
    preference: '偏好',
    preferenceHelpLabel: '查看图片分析偏好说明',
    preferenceHelp: '这些选项只会追加到视觉工具发给视觉模型的单次提示词，不会修改系统提示词、主对话上下文或 Harness 循环；全部保持默认时不会注入任何额外内容。',
    editPreference: '编辑',
    collapsePreference: '收起编辑',
    visualAnalysis: '视觉分析',
    visualAnalysisDefault: '默认',
    visualAnalysisEfficient: '效率优先',
    visualAnalysisDeep: '深入分析',
    focusAreas: '关注重点',
    focusDefault: '默认',
    focusText: '文字与 OCR',
    focusTables: '表格与图表',
    focusInterface: '界面与布局',
    focusObjects: '物体与场景',
    focusDetails: '异常与细节',
    customPreference: '自定义补充',
    preferencePlaceholder: '可选；补充希望视觉模型关注的信息',
    preferenceCounter: '{count}/50 字词',
    savePreference: '保存偏好',
    preferenceSaved: '偏好已保存，将从下一次图片分析开始生效。',
    empty: '尚未配置视觉服务方案。',
    add: '新增方案',
    edit: '编辑',
    collapseEdit: '收起编辑',
    remove: '删除',
    validate: '验证连接',
    saveAndValidate: '保存并验证',
    validationCostHelpLabel: '查看验证额度说明',
    validationCostHelp: '验证会发送一张极小测试图片并请求极短回复，可能消耗极少量模型额度。',
    validating: '正在验证…',
    validationSucceeded: '连接与多模态请求验证成功。',
    validationCredential: '验证失败：API Key 未配置或不可用。',
    validationTimeout: '验证失败：请求超时。',
    validationProvider: '验证失败：方案不存在或尚未生效。',
    validationConfiguration: '验证失败：方案中的协议、地址或模型配置无效。',
    validationNetwork: '验证失败：无法连接该地址，请检查域名、端口、TLS 和服务是否已启动。',
    validationInvalidJson: '已连接服务，但响应不是 JSON；该地址可能指向网页或错误的代理路由。',
    validationInvalidResponse: '已连接服务，但响应不符合所选协议或没有文本输出；请检查协议与模型。',
    validationResponseTooLarge: '验证失败：上游响应超过安全大小上限。',
    validationHttpAuthentication: '验证失败：上游返回 HTTP {status}，请检查 API Key、权限或账户状态。',
    validationHttpNotFound: '验证失败：上游返回 HTTP {status}，请检查地址结尾和模型名称。',
    validationHttpRateLimit: '验证失败：上游返回 HTTP {status}，请求受限或配额不足。',
    validationHttpRequest: '验证失败：上游返回 HTTP {status}，请检查协议、地址和模型。',
    validationHttpServer: '验证失败：上游返回 HTTP {status}，服务端暂时异常。',
    validationHttpGeneric: '验证失败：上游返回 HTTP {status}。',
    validationFailed: '验证失败：请检查协议、地址、模型与服务状态。',
    default: '默认',
    schemeId: '方案 ID',
    schemeIdHint: '保存后不可更改；可使用小写字母、数字、点、短横线或下划线。',
    displayName: '备注名',
    displayNameHint: '可选；仅用于显示，不影响方案 ID、模型或路由。',
    protocol: '协议',
    endpoint: 'API 地址',
    endpointHelpLabel: '查看 API 地址填写说明',
    endpointHint: '支持填写基础地址或所选协议的完整端点；问号内有示例。',
    endpointHelpResponses: '可填基础地址，例如 https://api.openai.com/v1；也可填以 /responses 结尾的完整端点。完整端点会自动拆分，避免重复拼接。不要填写模型名、查询参数或 # 片段。',
    endpointHelpChatCompletions: '可填基础地址，例如 https://api.openai.com/v1；也可填以 /chat/completions 结尾的完整端点。完整端点会自动拆分，避免重复拼接。不要填写模型名、查询参数或 # 片段。',
    endpointHelpAnthropicMessages: '可填基础地址，例如 https://api.anthropic.com；也可填以 /v1/messages 结尾的完整端点。完整端点会自动拆分，避免重复拼接。不要填写模型名、查询参数或 # 片段。',
    model: '模型',
    getModels: '获取模型',
    gettingModels: '正在获取…',
    chooseModel: '选择获取到的模型（{count}）',
    modelCapabilityHint: '请自行确认所选模型具备多模态能力。',
    modelsFetched: '已获取 {count} 个模型；也可以继续手动填写。',
    modelsEmpty: '连接成功，但服务没有返回可选模型；仍可手动填写模型名称。',
    apiKey: 'API Key',
    apiKeyHint: '仅写入凭据存储；编辑时留空会保留现有 Key。',
    cancel: '取消',
    save: '保存方案',
    saving: '正在保存…',
    saved: '方案已保存。',
    defaultSaved: '默认方案已更新。',
    removed: '方案已删除；其凭据不会被自动删除。',
    confirmRemove: '确定删除这个方案吗？已保存的 API Key 不会被自动删除。',
    invalidProfile: '请检查方案 ID、API 地址、模型和 API Key。',
    saveFailed: '保存失败，请刷新配置后重试。',
  },
  en: {
    title: 'Open Eyes',
    description: 'Configure vision providers, API credentials, and the default scheme.',
    expand: 'Expand settings',
    collapse: 'Collapse settings',
    loading: 'Loading configuration…',
    readOnly: 'This connection cannot edit plugin configuration.',
    unavailable: 'Configuration is temporarily unavailable. The last valid content is retained read-only.',
    enabled: 'Enable',
    enabledHelpLabel: 'Show enablement scope',
    enabledHelp: 'Switch changes apply only to new conversations. Existing conversations keep their creation-time state.',
    enabledSaved: 'Enablement saved. It will apply to new conversations.',
    preference: 'Preference',
    preferenceHelpLabel: 'Show image-analysis preference help',
    preferenceHelp: 'These options are appended only to the one-time prompt sent by the vision tool. They do not change the system prompt, main conversation context, or Harness loop; leaving everything at Default adds nothing.',
    editPreference: 'Edit',
    collapsePreference: 'Collapse edit',
    visualAnalysis: 'Visual analysis',
    visualAnalysisDefault: 'Default',
    visualAnalysisEfficient: 'Efficiency first',
    visualAnalysisDeep: 'In-depth analysis',
    focusAreas: 'Focus areas',
    focusDefault: 'Default',
    focusText: 'Text and OCR',
    focusTables: 'Tables and charts',
    focusInterface: 'Interface and layout',
    focusObjects: 'Objects and scenes',
    focusDetails: 'Anomalies and details',
    customPreference: 'Custom supplement',
    preferencePlaceholder: 'Optional: add information for the vision model to focus on',
    preferenceCounter: '{count}/50 words',
    savePreference: 'Save preferences',
    preferenceSaved: 'Preference saved. It applies to the next image analysis.',
    empty: 'No vision provider scheme is configured.',
    add: 'Add scheme',
    edit: 'Edit',
    collapseEdit: 'Collapse edit',
    remove: 'Delete',
    validate: 'Validate connection',
    saveAndValidate: 'Save and validate',
    validationCostHelpLabel: 'Show validation usage note',
    validationCostHelp: 'Validation sends one tiny test image and requests a very short reply, so it may consume a minimal amount of model quota.',
    validating: 'Validating…',
    validationSucceeded: 'Connection and multimodal request validated.',
    validationCredential: 'Validation failed: the API key is missing or unavailable.',
    validationTimeout: 'Validation failed: the request timed out.',
    validationProvider: 'Validation failed: the scheme is missing or not active.',
    validationConfiguration: 'Validation failed: the scheme protocol, endpoint, or model is invalid.',
    validationNetwork: 'Validation failed: could not reach this endpoint. Check DNS, port, TLS, and whether the service is running.',
    validationInvalidJson: 'The service was reached, but its response was not JSON. The endpoint may point to a web page or the wrong proxy route.',
    validationInvalidResponse: 'The service was reached, but its response did not match the selected protocol or contained no text. Check the protocol and model.',
    validationResponseTooLarge: 'Validation failed: the upstream response exceeded the safe size limit.',
    validationHttpAuthentication: 'Validation failed: upstream returned HTTP {status}. Check the API key, permissions, or account status.',
    validationHttpNotFound: 'Validation failed: upstream returned HTTP {status}. Check the endpoint suffix and model name.',
    validationHttpRateLimit: 'Validation failed: upstream returned HTTP {status}. The request was rate-limited or quota is unavailable.',
    validationHttpRequest: 'Validation failed: upstream returned HTTP {status}. Check the protocol, endpoint, and model.',
    validationHttpServer: 'Validation failed: upstream returned HTTP {status}. The service is temporarily failing.',
    validationHttpGeneric: 'Validation failed: upstream returned HTTP {status}.',
    validationFailed: 'Validation failed. Check the protocol, endpoint, model, and service status.',
    default: 'Default',
    schemeId: 'Scheme ID',
    schemeIdHint: 'Cannot be changed after saving; use lowercase letters, numbers, dots, hyphens, or underscores.',
    displayName: 'Display name',
    displayNameHint: 'Optional and presentation-only; it does not change the scheme ID, model, or routing.',
    protocol: 'Protocol',
    endpoint: 'API endpoint',
    endpointHelpLabel: 'Show API endpoint instructions',
    endpointHint: 'Enter either a base URL or the full endpoint for the selected protocol; see examples in the question mark.',
    endpointHelpResponses: 'Enter a base URL such as https://api.openai.com/v1, or the full endpoint ending in /responses. A full endpoint is split automatically so the suffix is not appended twice. Do not include a model name, query string, or fragment.',
    endpointHelpChatCompletions: 'Enter a base URL such as https://api.openai.com/v1, or the full endpoint ending in /chat/completions. A full endpoint is split automatically so the suffix is not appended twice. Do not include a model name, query string, or fragment.',
    endpointHelpAnthropicMessages: 'Enter a base URL such as https://api.anthropic.com, or the full endpoint ending in /v1/messages. A full endpoint is split automatically so the suffix is not appended twice. Do not include a model name, query string, or fragment.',
    model: 'Model',
    getModels: 'Get models',
    gettingModels: 'Getting models…',
    chooseModel: 'Choose from {count} models',
    modelCapabilityHint: 'Please verify that the selected model supports multimodal input.',
    modelsFetched: 'Found {count} models. You can still enter a model manually.',
    modelsEmpty: 'The service connected but returned no models. You can still enter a model manually.',
    apiKey: 'API Key',
    apiKeyHint: 'Written only to credential storage; leave blank while editing to keep the current key.',
    cancel: 'Cancel',
    save: 'Save scheme',
    saving: 'Saving…',
    saved: 'Scheme saved.',
    defaultSaved: 'Default scheme updated.',
    removed: 'Scheme deleted; its credential was not removed automatically.',
    confirmRemove: 'Delete this scheme? Its saved API Key will not be removed automatically.',
    invalidProfile: 'Check the scheme ID, API endpoint, model, and API Key.',
    saveFailed: 'Save failed. Refresh the configuration and try again.',
  },
} as const

type LocaleKey = keyof typeof settingsCardLocales.en
type Translate = (key: LocaleKey) => string

interface VisualPreferenceDraft {
  readonly visualAnalysis: VisualAnalysisMode
  readonly focusAreas: readonly VisualFocusArea[]
  readonly preference: string
}

const ANALYSIS_LOCALE_KEYS: Readonly<Record<VisualAnalysisMode, LocaleKey>> = {
  default: 'visualAnalysisDefault',
  efficient: 'visualAnalysisEfficient',
  deep: 'visualAnalysisDeep',
}

const FOCUS_LOCALE_KEYS: Readonly<Record<VisualFocusArea, LocaleKey>> = {
  text: 'focusText',
  tables: 'focusTables',
  interface: 'focusInterface',
  objects: 'focusObjects',
  details: 'focusDetails',
}

function asVisualPreferences(settings: VisionBridgeSettings | undefined): VisualPreferenceDraft {
  return {
    visualAnalysis: settings?.visualAnalysis ?? 'default',
    focusAreas: settings?.focusAreas ?? [],
    preference: settings?.preference ?? '',
  }
}

export interface ProviderSettingsCardProps {
  readonly scope: SettingsScope<VisionBridgeSettings>
  readonly api: SettingsCardApi
  readonly t: Translate
}

export interface EditorState {
  readonly existingId: string | null
  readonly draft: ProviderProfileDraft
}

export function groupProviderEntries<T extends readonly [string, unknown]>(
  entries: readonly T[],
  editingId: string | null,
): readonly { readonly id: T[0]; readonly profile: T[1]; readonly editing: boolean }[] {
  return entries.map(([id, profile]) => ({ id, profile, editing: id === editingId })) as readonly {
    readonly id: T[0]
    readonly profile: T[1]
    readonly editing: boolean
  }[]
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
    background: 'var(--dsw-alias-bg-layer-3)', transition: 'border-color .16s, background .16s',
  },
  cardOpen: {
    background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)',
  },
  header: {
    width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 16px', borderRadius: 12,
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  chevron: {
    flex: 'none', display: 'inline-flex', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s',
  },
  chevronOpen: { transform: 'rotate(180deg)' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 },
  notice: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  enableRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    margin: '12px 0 0', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)',
  },
  preferenceRow: {
    display: 'grid', gap: 0,
    margin: '8px 0 0', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)',
  },
  preferenceHeader: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', minWidth: 0,
    alignItems: 'center', gap: 12,
  },
  preferenceEditor: {
    display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12, padding: '14px 16px',
    borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)',
  },
  preferenceFields: {
    display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12,
  },
  preferenceSelect: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  menuAnchor: { width: '100%', justifyContent: 'space-between' },
  textarea: {
    width: '100%', minHeight: 88, boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
    font: 'inherit', fontSize: 13, lineHeight: 1.5, outline: 'none',
  },
  inputError: { borderColor: 'var(--dsw-alias-state-error-primary)' },
  errorText: { color: 'var(--dsw-alias-state-error-primary)' },
  preferenceFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  list: { display: 'grid', gap: 8, margin: '12px 0 0', padding: 0, listStyle: 'none' },
  rowGroup: { display: 'grid', gap: 8, listStyle: 'none' },
  row: {
    display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 12, alignItems: 'center',
    padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-3)',
  },
  rowEditing: { borderColor: 'var(--dsw-alias-label-dimmed)' },
  radio: { accentColor: 'var(--dsw-alias-brand-primary)' },
  rowText: { minWidth: 0 },
  rowTitle: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13,
    fontWeight: 500, color: 'var(--dsw-alias-label-primary)',
  },
  rowMeta: {
    marginTop: 4, overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.5,
    color: 'var(--dsw-alias-label-tertiary)',
  },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  addRow: { marginTop: 12 },
  editor: {
    display: 'flex', flexDirection: 'column', gap: 14, marginTop: 0, padding: '14px 16px',
    borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)',
  },
  editorNew: { marginTop: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabelRow: { display: 'flex', alignItems: 'center', gap: 4 },
  fieldLabel: { fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
  helpButton: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24,
    padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'help',
    color: 'var(--dsw-alias-label-tertiary)',
  },
  inputElement: { width: '100%', boxSizing: 'border-box' },
  select: {
    width: '100%', height: 34, padding: '0 12px', border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontSize: 13,
    color: 'var(--dsw-alias-label-primary)',
  },
  hint: { fontSize: 12, fontWeight: 400, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  footer: { display: 'flex', minHeight: 28, alignItems: 'center' },
  status: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
}

function validationMessage(error: string, t: Translate): string {
  return ['invalid-profile-id', 'invalid-display-name', 'missing-base-url', 'missing-model', 'invalid-base-url', 'missing-api-key'].includes(error)
    ? t('invalidProfile')
    : t('saveFailed')
}

function withStatus(message: string, status: number | undefined): string {
  return message.replace('{status}', status === undefined ? '—' : String(status))
}

export function providerValidationMessage(
  result: Extract<ProviderValidationResult, { readonly ok: false }>,
  t: Translate,
): string {
  if (result.error === 'VISION_CREDENTIAL_MISSING') return t('validationCredential')
  if (result.error === 'VISION_TIMEOUT' || result.error === 'VISION_ABORTED') return t('validationTimeout')
  if (result.error === 'VISION_PROVIDER_NOT_FOUND' || result.error === 'VISION_NOT_CONFIGURED') return t('validationProvider')
  if (result.error === 'VISION_INVALID_ARGUMENT' || result.error === 'VISION_IMAGE_VALIDATION_FAILED') {
    return t('validationConfiguration')
  }
  if (result.error === 'VISION_RESPONSE_TOO_LARGE' || result.diagnostic?.reason === 'response-too-large') {
    return t('validationResponseTooLarge')
  }
  if (result.diagnostic?.reason === 'network') return t('validationNetwork')
  if (result.diagnostic?.reason === 'invalid-json') return t('validationInvalidJson')
  if (result.diagnostic?.reason === 'invalid-response') return t('validationInvalidResponse')
  if (result.diagnostic?.reason === 'http') {
    const status = result.diagnostic.httpStatus
    if (status === 401 || status === 403) return withStatus(t('validationHttpAuthentication'), status)
    if (status === 404) return withStatus(t('validationHttpNotFound'), status)
    if (status === 429) return withStatus(t('validationHttpRateLimit'), status)
    if (status !== undefined && status >= 500) return withStatus(t('validationHttpServer'), status)
    if (status !== undefined && status >= 400) return withStatus(t('validationHttpRequest'), status)
    return withStatus(t('validationHttpGeneric'), status)
  }
  return t('validationFailed')
}

function endpointHelpKey(protocol: Protocol): LocaleKey {
  if (protocol === 'openai-responses') return 'endpointHelpResponses'
  if (protocol === 'openai-chat-completions') return 'endpointHelpChatCompletions'
  return 'endpointHelpAnthropicMessages'
}

function newEditor(): EditorState {
  return {
    existingId: null,
    draft: { id: '', displayName: '', protocol: 'openai-responses', baseUrl: '', model: '', apiKey: '' },
  }
}

function editEditor(id: string, profile: VisionBridgeProviderProfile): EditorState {
  return {
    existingId: id,
    draft: {
      id,
      displayName: profile.displayName ?? '',
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: '',
      ...(profile.credential === undefined ? {} : { credential: profile.credential }),
      ...(profile.authMode === undefined ? {} : { authMode: profile.authMode }),
    },
  }
}

export function toggleProviderEditor(
  current: EditorState | null,
  id: string,
  profile: VisionBridgeProviderProfile,
  _isDefault?: boolean,
): EditorState | null {
  return current?.existingId === id ? null : editEditor(id, profile)
}

export function editButtonPresentation(editing: boolean): {
  readonly variant: 'primary' | 'outline'
  readonly label: 'collapseEdit' | 'edit'
} {
  return editing
    ? { variant: 'primary', label: 'collapseEdit' }
    : { variant: 'outline', label: 'edit' }
}

function withCount(message: string, count: number): string {
  return message.replace('{count}', String(count))
}

export function ProviderSettingsCard(props: ProviderSettingsCardProps): React.ReactElement | null {
  const { scope, api, t } = props
  const cardRef = React.useRef<HTMLLIElement>(null)
  const subscribe = React.useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const read = React.useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = React.useSyncExternalStore(subscribe, read, read)
  const lastValidSettings = React.useRef<VisionBridgeSettings | undefined>(undefined)
  if (snapshot.value !== undefined) lastValidSettings.current = snapshot.value
  const [open, setOpen] = React.useState(false)
  const [editor, setEditor] = React.useState<EditorState | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savingEnabled, setSavingEnabled] = React.useState(false)
  const [savingPreference, setSavingPreference] = React.useState(false)
  const [preferenceEditorOpen, setPreferenceEditorOpen] = React.useState(false)
  const [analysisMenuOpen, setAnalysisMenuOpen] = React.useState(false)
  const [focusMenuOpen, setFocusMenuOpen] = React.useState(false)
  const [gettingModels, setGettingModels] = React.useState(false)
  const [discoveredModels, setDiscoveredModels] = React.useState<readonly string[]>([])
  const [stagedCredential, setStagedCredential] = React.useState<string | null>(null)
  const saveIntent = React.useRef<'save' | 'validate'>('save')
  const [status, setStatus] = React.useState('')
  const [validatingId, setValidatingId] = React.useState<string | null>(null)
  const toastSequence = React.useRef(0)
  const [validationToast, setValidationToast] = React.useState<{ readonly id: number; readonly text: string } | null>(null)

  const settings = snapshot.value ?? lastValidSettings.current
  const preferenceSource = asVisualPreferences(settings)
  const preferenceSourceKey = JSON.stringify(preferenceSource)
  const [preferenceDraft, setPreferenceDraft] = React.useState<VisualPreferenceDraft>(preferenceSource)
  const previousPreferenceSource = React.useRef(preferenceSourceKey)
  React.useEffect(() => {
    if (preferenceSourceKey === previousPreferenceSource.current) return
    previousPreferenceSource.current = preferenceSourceKey
    setPreferenceDraft(preferenceSource)
  }, [preferenceSourceKey])
  const profiles = settings?.profiles ?? {}
  const disabledProfiles = settings?.disabledProfiles ?? []
  const disabled = new Set(disabledProfiles)
  const profileEntries = Object.entries(profiles)
    .filter(([id]) => !disabled.has(id))
    .sort(([left], [right]) => left.localeCompare(right))
  const providerGroups = groupProviderEntries(profileEntries, editor?.existingId ?? null)
  const writable = snapshot.status !== 'unavailable' && snapshot.writable && snapshot.revision !== undefined
  const analysisMenuItems: readonly MenuEntry[] = [
    { id: 'default', label: t('visualAnalysisDefault') },
    { id: 'efficient', label: t('visualAnalysisEfficient') },
    { id: 'deep', label: t('visualAnalysisDeep') },
  ]
  const focusMenuItems: readonly MenuEntry[] = [
    { id: 'default', label: t('focusDefault') },
    { type: 'separator', id: 'focus-separator' },
    ...VISUAL_FOCUS_AREAS.map(area => ({ id: area, label: t(FOCUS_LOCALE_KEYS[area]) })),
  ]
  const focusSummary = preferenceDraft.focusAreas.length === 0
    ? t('focusDefault')
    : preferenceDraft.focusAreas.map(area => t(FOCUS_LOCALE_KEYS[area])).join('、')
  const preferenceUnits = countPreferenceUnits(preferenceDraft.preference)
  const preferenceOverLimit = preferenceUnits > MAX_CUSTOM_PREFERENCE_UNITS
  const preferenceChanged = preferenceDraft.visualAnalysis !== preferenceSource.visualAnalysis
    || preferenceDraft.focusAreas.join('\0') !== preferenceSource.focusAreas.join('\0')
    || preferenceDraft.preference.trim() !== preferenceSource.preference.trim()

  const showValidationToast = (text: string): void => {
    toastSequence.current += 1
    setValidationToast({ id: toastSequence.current, text })
  }

  const updateDraft = (patch: Partial<ProviderProfileDraft>): void => {
    setEditor(current => current === null ? null : { ...current, draft: { ...current.draft, ...patch } })
  }

  const discardStagedCredential = async (credential = stagedCredential): Promise<void> => {
    if (credential === null) return
    try {
      await api.credentials.unset({ ref: credential })
    } catch {
      // A failed cleanup remains unreferenced and never crosses rendered output.
    }
    setStagedCredential(current => current === credential ? null : current)
  }

  const closeEditor = async (): Promise<void> => {
    await discardStagedCredential()
    setDiscoveredModels([])
    setEditor(null)
  }

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (editor === null || snapshot.revision === undefined || !snapshot.writable) return
    setSaving(true)
    setStatus('')
    const currentProfile = editor.existingId === null ? undefined : profiles[editor.existingId]
    const intent = saveIntent.current
    saveIntent.current = 'save'
    const result = await saveProviderProfile(api, editor.draft, {
      revision: snapshot.revision,
      ...(settings?.defaultProvider === undefined ? {} : { currentDefault: settings.defaultProvider }),
      existingProfileIds: profileEntries.map(([id]) => id),
      disabledProfiles,
      ...(currentProfile === undefined ? {} : { currentProfile }),
    })
    setSaving(false)
    if (!result.ok) {
      setStatus(validationMessage(result.error, t))
      return
    }
    if (stagedCredential !== null) {
      if (result.profile.credential !== stagedCredential) await discardStagedCredential(stagedCredential)
      else setStagedCredential(null)
    }
    if (intent === 'validate') {
      setEditor(editEditor(result.id, result.profile))
      setStatus('')
      await validate(result.id)
    } else {
      setDiscoveredModels([])
      setEditor(null)
      setStatus(t('saved'))
    }
  }

  const changeEnabled = async (enabled: boolean): Promise<void> => {
    if (!writable || snapshot.revision === undefined || savingEnabled) return
    setSavingEnabled(true)
    setStatus('')
    const result = await setOpenEyesEnabled(api, enabled, {
      revision: snapshot.revision,
      currentEnabled: settings?.enabled ?? true,
      ...(settings?.enablementHistory === undefined ? {} : { history: settings.enablementHistory }),
    })
    setStatus(result.ok ? t('enabledSaved') : t('saveFailed'))
    setSavingEnabled(false)
  }

  const savePreference = async (): Promise<void> => {
    if (!writable || snapshot.revision === undefined || savingPreference) return
    setSavingPreference(true)
    setStatus('')
    const result = await setOpenEyesPreferences(api, preferenceDraft, snapshot.revision)
    if (result.ok) {
      const normalized = { ...preferenceDraft, preference: preferenceDraft.preference.trim() }
      previousPreferenceSource.current = JSON.stringify(normalized)
      setPreferenceDraft(normalized)
      setPreferenceEditorOpen(false)
      setAnalysisMenuOpen(false)
      setFocusMenuOpen(false)
    }
    setStatus(result.ok ? t('preferenceSaved') : t('saveFailed'))
    setSavingPreference(false)
  }

  const chooseDefault = async (id: string): Promise<void> => {
    if (snapshot.revision === undefined || !snapshot.writable || id === settings?.defaultProvider) return
    setStatus('')
    const result = await selectDefaultProvider(api, id, snapshot.revision)
    setStatus(result.ok ? t('defaultSaved') : t('saveFailed'))
  }

  const remove = async (id: string): Promise<void> => {
    if (snapshot.revision === undefined || !snapshot.writable) return
    if (typeof window !== 'undefined' && !window.confirm(t('confirmRemove'))) return
    const result = await deleteProviderProfile(api, id, {
      revision: snapshot.revision,
      currentDefault: settings?.defaultProvider,
      remainingIds: profileEntries.map(([profileId]) => profileId).filter(profileId => profileId !== id),
      disabledProfiles,
    })
    if (result.ok) {
      if (editor?.existingId === id) setEditor(null)
    }
    setStatus(result.ok ? t('removed') : t('saveFailed'))
  }

  const validate = async (id: string): Promise<void> => {
    if (validatingId !== null) return
    setValidatingId(id)
    const result = await requestProviderValidation(id)
    showValidationToast(result.ok ? t('validationSucceeded') : providerValidationMessage(result, t))
    setValidatingId(null)
  }

  const getModels = async (): Promise<void> => {
    if (editor === null || gettingModels || saving) return
    setGettingModels(true)
    setStatus('')
    const currentProfile = editor.existingId === null ? undefined : profiles[editor.existingId]
    const prepared = await prepareProviderModelDiscovery(api, editor.draft, currentProfile)
    if (!prepared.ok) {
      setStatus(validationMessage(prepared.error, t))
      setGettingModels(false)
      return
    }
    if (stagedCredential !== null && stagedCredential !== prepared.stagedCredential) {
      await discardStagedCredential(stagedCredential)
    }
    if (prepared.stagedCredential !== undefined) {
      const staged = prepared.stagedCredential
      setStagedCredential(staged)
      setEditor(current => current === null ? null : {
        ...current,
        draft: {
          ...current.draft,
          apiKey: '',
          credential: staged,
        },
      })
    }
    const result = await requestProviderModels(prepared.draft)
    if (result.ok) {
      setDiscoveredModels(result.models)
      setStatus(result.models.length === 0
        ? t('modelsEmpty')
        : withCount(t('modelsFetched'), result.models.length))
    } else {
      setDiscoveredModels([])
      setStatus(providerValidationMessage(result, t))
    }
    setGettingModels(false)
  }

  const renderEditorForm = (): React.ReactElement | null => editor === null
    ? null
    : (
      <form
        style={{ ...styles.editor, ...(editor.existingId === null ? styles.editorNew : {}) }}
        onSubmit={event => { void save(event) }}
      >
        <label style={styles.field}>
          <span style={styles.fieldLabel}>{t('schemeId')}</span>
          <Input
            style={styles.inputElement}
            value={editor.draft.id}
            disabled={editor.existingId !== null || saving}
            required
            pattern="[a-z0-9][a-z0-9._-]*"
            onChange={event => {
              const id = event.currentTarget.value
              updateDraft({ id })
            }}
          />
          <span style={styles.hint}>{t('schemeIdHint')}</span>
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>{t('displayName')}</span>
          <Input
            style={styles.inputElement}
            value={editor.draft.displayName ?? ''}
            maxLength={120}
            disabled={saving}
            onChange={event => {
              const displayName = event.currentTarget.value
              updateDraft({ displayName })
            }}
          />
          <span style={styles.hint}>{t('displayNameHint')}</span>
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>{t('protocol')}</span>
          <select
            style={styles.select}
            value={editor.draft.protocol}
            disabled={saving}
            onChange={event => {
              const protocol = event.currentTarget.value as Protocol
              setEditor(current => {
                if (current === null) return null
                const { authMode: _authMode, ...draft } = current.draft
                return { ...current, draft: { ...draft, protocol } }
              })
            }}
          >
            {PROTOCOLS.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
          </select>
        </label>
        <div style={styles.field}>
          <div style={styles.fieldLabelRow}>
            <label style={styles.fieldLabel} htmlFor="dsh-open-eyes-provider-endpoint">{t('endpoint')}</label>
            <Tooltip label={t(endpointHelpKey(editor.draft.protocol))} side="top" maxWidth={420}>
              <button
                type="button"
                style={styles.helpButton}
                aria-label={t('endpointHelpLabel')}
              >
                <IconQuestionOutline14 />
              </button>
            </Tooltip>
          </div>
          <Input
            id="dsh-open-eyes-provider-endpoint"
            style={styles.inputElement}
            type="url"
            value={editor.draft.baseUrl}
            disabled={saving}
            required
            placeholder="https://api.example.com/v1"
            onChange={event => {
              const baseUrl = event.currentTarget.value
              updateDraft({ baseUrl })
            }}
          />
          <span style={styles.hint}>{t('endpointHint')}</span>
        </div>
        <div style={styles.field}>
          <div style={{ ...styles.fieldLabelRow, justifyContent: 'space-between' }}>
            <label style={styles.fieldLabel} htmlFor="dsh-open-eyes-provider-model">{t('model')}</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || gettingModels}
              onClick={() => { void getModels() }}
            >
              <IconRefreshOutline14 />
              {t(gettingModels ? 'gettingModels' : 'getModels')}
            </Button>
          </div>
          <Input
            id="dsh-open-eyes-provider-model"
            style={styles.inputElement}
            value={editor.draft.model}
            disabled={saving}
            required
            onChange={event => {
              const model = event.currentTarget.value
              updateDraft({ model })
            }}
          />
          {discoveredModels.length === 0
            ? null
            : (
              <select
                style={styles.select}
                value=""
                aria-label={withCount(t('chooseModel'), discoveredModels.length)}
                onChange={event => {
                  const model = event.currentTarget.value
                  if (model) updateDraft({ model })
                }}
              >
                <option value="">{withCount(t('chooseModel'), discoveredModels.length)}</option>
                {discoveredModels.map(model => <option key={model} value={model}>{model}</option>)}
              </select>
              )}
          {discoveredModels.length === 0 ? null : <span style={styles.hint}>{t('modelCapabilityHint')}</span>}
        </div>
        {editor.draft.authMode !== 'none'
          ? (
            <label style={styles.field}>
              <span style={styles.fieldLabel}>{t('apiKey')}</span>
              <Input
                style={styles.inputElement}
                type="password"
                autoComplete="new-password"
                value={editor.draft.apiKey}
                disabled={saving}
                required={editor.existingId === null && editor.draft.credential === undefined}
                onChange={event => {
                  const apiKey = event.currentTarget.value
                  updateDraft({ apiKey })
                }}
              />
              <span style={styles.hint}>{t('apiKeyHint')}</span>
            </label>
            )
          : null}
        <div style={styles.actions}>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => { void closeEditor() }}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => { saveIntent.current = 'validate' }}
          >
            {t('saveAndValidate')}
          </Button>
          <Tooltip label={t('validationCostHelp')} side="top" maxWidth={320}>
            <button type="button" style={styles.helpButton} aria-label={t('validationCostHelpLabel')}>
              <IconQuestionOutline14 />
            </button>
          </Tooltip>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={() => { saveIntent.current = 'save' }}
          >
            {t(saving ? 'saving' : 'save')}
          </Button>
        </div>
      </form>
      )

  return (
    <li ref={cardRef} style={{ ...styles.card, ...(open ? styles.cardOpen : {}) }}>
      <style>{`
        .dsh-open-eyes-danger-button { color: var(--dsw-alias-state-error-primary); }
        .dsh-open-eyes-danger-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
      `}</style>
      {validationToast === null
        ? null
        : (
          <Toast
            key={validationToast.id}
            text={validationToast.text}
            anchor={cardRef.current}
            onDone={() => {
              setValidationToast(current => current?.id === validationToast.id ? null : current)
            }}
          />
          )}
      <button
        type="button"
        style={styles.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(current => !current) }}
      >
        <span style={styles.headText}>
          <span style={styles.name}>{t('title')}</span>
          <span style={styles.description}>{t('description')}</span>
        </span>
        <span style={{ ...styles.chevron, ...(open ? styles.chevronOpen : {}) }}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? (
        <div style={styles.body}>
          {snapshot.status === 'loading' ? <p style={styles.notice}>{t('loading')}</p> : null}
          {snapshot.status === 'unavailable' ? <p style={styles.notice} role="status">{t('unavailable')}</p> : null}
          {!snapshot.writable ? <p style={styles.notice} role="status">{t('readOnly')}</p> : null}
          <div style={styles.enableRow}>
            <div style={styles.fieldLabelRow}>
              <label style={styles.fieldLabel} htmlFor="dsh-open-eyes-enabled">{t('enabled')}</label>
              <Tooltip label={t('enabledHelp')} side="top" maxWidth={360}>
                <button type="button" style={styles.helpButton} aria-label={t('enabledHelpLabel')}>
                  <IconQuestionOutline14 />
                </button>
              </Tooltip>
            </div>
            <input
              id="dsh-open-eyes-enabled"
              style={styles.radio}
              type="checkbox"
              role="switch"
              checked={settings?.enabled ?? true}
              disabled={!writable || savingEnabled}
              onChange={event => {
                const enabled = event.currentTarget.checked
                void changeEnabled(enabled)
              }}
            />
          </div>
          <div style={styles.preferenceRow}>
            <div style={styles.preferenceHeader}>
              <div style={styles.rowText}>
                <div style={styles.fieldLabelRow}>
                  <span style={styles.fieldLabel}>{t('preference')}</span>
                  <Tooltip label={t('preferenceHelp')} side="top" maxWidth={460}>
                    <button type="button" style={styles.helpButton} aria-label={t('preferenceHelpLabel')}>
                      <IconQuestionOutline14 />
                    </button>
                  </Tooltip>
                </div>
              </div>
              <Button
                type="button"
                variant={preferenceEditorOpen ? 'primary' : 'outline'}
                size="sm"
                disabled={!writable || savingPreference}
                onClick={() => {
                  if (preferenceEditorOpen) {
                    setPreferenceDraft(preferenceSource)
                    setAnalysisMenuOpen(false)
                    setFocusMenuOpen(false)
                  }
                  setPreferenceEditorOpen(!preferenceEditorOpen)
                }}
              >
                {t(preferenceEditorOpen ? 'collapsePreference' : 'editPreference')}
              </Button>
            </div>
            {preferenceEditorOpen
              ? (
                <div style={styles.preferenceEditor}>
                  <div style={styles.preferenceFields}>
                    <div style={styles.preferenceSelect}>
                      <span style={styles.fieldLabel}>{t('visualAnalysis')}</span>
                      <Menu
                        open={analysisMenuOpen}
                        items={analysisMenuItems}
                        selectedId={preferenceDraft.visualAnalysis}
                        onClose={() => { setAnalysisMenuOpen(false) }}
                        onSelect={id => {
                          if (id !== 'default' && id !== 'efficient' && id !== 'deep') return
                          setPreferenceDraft(current => ({ ...current, visualAnalysis: id }))
                          setAnalysisMenuOpen(false)
                        }}
                        portal
                        anchor={(
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            style={styles.menuAnchor}
                            disabled={savingPreference}
                            onClick={() => { setAnalysisMenuOpen(current => !current) }}
                          >
                            {t(ANALYSIS_LOCALE_KEYS[preferenceDraft.visualAnalysis])}
                            <IconChevronDownOutline14 />
                          </Button>
                        )}
                      />
                    </div>
                    <div style={styles.preferenceSelect}>
                      <span style={styles.fieldLabel}>{t('focusAreas')}</span>
                      <Menu
                        open={focusMenuOpen}
                        items={focusMenuItems}
                        selectedId={preferenceDraft.focusAreas.length === 0 ? 'default' : undefined}
                        selectedIds={preferenceDraft.focusAreas}
                        onClose={() => { setFocusMenuOpen(false) }}
                        onSelect={id => {
                          if (id === 'default') {
                            setPreferenceDraft(current => ({ ...current, focusAreas: [] }))
                            return
                          }
                          if (!(VISUAL_FOCUS_AREAS as readonly string[]).includes(id)) return
                          const area = id as VisualFocusArea
                          setPreferenceDraft(current => ({
                            ...current,
                            focusAreas: current.focusAreas.includes(area)
                              ? current.focusAreas.filter(item => item !== area)
                              : VISUAL_FOCUS_AREAS.filter(item => current.focusAreas.includes(item) || item === area),
                          }))
                        }}
                        portal
                        anchor={(
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            style={styles.menuAnchor}
                            disabled={savingPreference}
                            onClick={() => { setFocusMenuOpen(current => !current) }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focusSummary}</span>
                            <IconChevronDownOutline14 />
                          </Button>
                        )}
                      />
                    </div>
                  </div>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>{t('customPreference')}</span>
                    <textarea
                      id="dsh-open-eyes-preference"
                      style={{ ...styles.textarea, ...(preferenceOverLimit ? styles.inputError : {}) }}
                      value={preferenceDraft.preference}
                      maxLength={2_000}
                      disabled={savingPreference}
                      aria-invalid={preferenceOverLimit}
                      placeholder={t('preferencePlaceholder')}
                      onChange={event => {
                        const preference = event.currentTarget.value
                        setPreferenceDraft(current => ({ ...current, preference }))
                      }}
                    />
                  </label>
                  <div style={styles.preferenceFooter}>
                    <span style={{ ...styles.hint, ...(preferenceOverLimit ? styles.errorText : {}) }}>
                      {withCount(t('preferenceCounter'), preferenceUnits)}
                    </span>
                    <div style={styles.actions}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={savingPreference}
                        onClick={() => {
                          setPreferenceDraft(preferenceSource)
                          setPreferenceEditorOpen(false)
                          setAnalysisMenuOpen(false)
                          setFocusMenuOpen(false)
                        }}
                      >
                        {t('cancel')}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={!writable || savingPreference || !preferenceChanged || preferenceOverLimit}
                        onClick={() => { void savePreference() }}
                      >
                        {t('savePreference')}
                      </Button>
                    </div>
                  </div>
                </div>
                )
              : null}
          </div>
          {snapshot.status === 'ready' && profileEntries.length === 0
            ? <p style={styles.notice}>{t('empty')}</p>
            : null}
          <ul style={styles.list}>
            {providerGroups.map(({ id, profile, editing }) => {
              return (
                <li key={id} style={styles.rowGroup}>
                  <div style={{ ...styles.row, ...(editing ? styles.rowEditing : {}) }}>
                    <input
                      style={styles.radio}
                      type="radio"
                      name="dsh-open-eyes-default-provider"
                      aria-label={`${t('default')}: ${id}`}
                      checked={settings?.defaultProvider === id}
                      disabled={!writable}
                      onChange={() => { void chooseDefault(id) }}
                    />
                    <div style={styles.rowText}>
                      <div style={styles.rowTitle}>
                        <span>{profile.displayName?.trim() || id}</span>
                      </div>
                      <div style={styles.rowMeta}>{profile.model}</div>
                    </div>
                    <div style={styles.actions}>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={validatingId !== null}
                        onClick={() => { void validate(id) }}
                      >
                        {t(validatingId === id ? 'validating' : 'validate')}
                      </Button>
                      <Tooltip label={t('validationCostHelp')} side="top" maxWidth={320}>
                        <button type="button" style={styles.helpButton} aria-label={t('validationCostHelpLabel')}>
                          <IconQuestionOutline14 />
                        </button>
                      </Tooltip>
                      <Button
                        variant={editButtonPresentation(editing).variant}
                        size="sm"
                        disabled={!writable}
                        onClick={() => {
                          setStatus('')
                          setDiscoveredModels([])
                          if (editor?.existingId === id) {
                            void closeEditor()
                            return
                          }
                          if (stagedCredential !== null) void discardStagedCredential()
                          setEditor(current => toggleProviderEditor(
                            current,
                            id,
                            profile,
                          ))
                        }}
                      >
                        {t(editButtonPresentation(editing).label)}
                      </Button>
                      <Button
                        className="dsh-open-eyes-danger-button"
                        variant="ghost"
                        size="sm"
                        disabled={!writable}
                        onClick={() => { void remove(id) }}
                      >
                        {t('remove')}
                      </Button>
                    </div>
                  </div>
                  {editing ? renderEditorForm() : null}
                </li>
              )
            })}
          </ul>

          {editor === null
            ? (
              <div style={styles.addRow}>
                <Button variant="primary" size="sm" disabled={!writable} onClick={() => {
                  setStatus('')
                  setDiscoveredModels([])
                  setEditor(newEditor())
                }}>
                  {t('add')}
                </Button>
              </div>
            )
            : editor.existingId === null ? renderEditorForm() : null}
          <div style={styles.footer}>
            <p style={styles.status} role="status" aria-live="polite">{status}</p>
          </div>
        </div>
          )
        : null}
    </li>
  )
}
