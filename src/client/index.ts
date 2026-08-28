import { createVisionBridgeSendSession } from './bridge.js'
import type { BridgeConversation } from './bridge.js'
import { BRIDGE_REFERENCE_FIELD, projectBridgeContent } from './chat-render.js'
import type { ChatContentBlock } from './chat-render.js'
import { createBridgeHistoryImageLoader } from './image-loader.js'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PACKAGE_NAME } from '../package-name.js'
import {
  ProviderSettingsCard,
  SETTINGS_CARD_LOCALE_NAMESPACE,
  settingsCardLocales,
} from './settings-card-view.js'
import type { SettingsCardApi } from './settings-card.js'
import {
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  type VisionBridgeSettings,
} from '../settings-contract.js'
import { createElement } from 'react'
import type { ElementType, ReactElement } from 'react'

export const inject = [
  'conversation', 'remote', 'remote.settings', 'remote.credentials', 'slots', 'settingsScope', 'locale',
]

interface ClientContextLike {
  get(name: string): unknown
  effect(execute: () => (() => void), label?: string): unknown
}

interface SlotEntryLike {
  /** React components include memo/forwardRef exotic objects, not just functions. */
  readonly component: ElementType
  readonly options: { readonly key?: string }
}

interface SlotsServiceLike {
  register(
    options: { name: string; key?: string; priority?: number; locale?: string; registrant?: string },
    component: (props: never) => unknown,
  ): () => void
  entries(name: string): readonly SlotEntryLike[]
  inject(name: string, install: () => unknown): unknown
}

interface SettingsScopeBinderLike {
  bind<T>(spec: { readonly namespace: string }): SettingsScope<T>
}

interface LocaleServiceLike {
  register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): () => void
  bind(namespace: string): (key: string) => string
}

const PATCH_MARKER = Symbol.for(`${PACKAGE_NAME}.client.send-session`)
const RENDER_MARKER = Symbol.for(`${PACKAGE_NAME}.client.chat-render`)
const IMAGE_RENDER_MARKER = Symbol.for(`${PACKAGE_NAME}.client.message-images`)
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
const ACTIVE_ATTRIBUTE = `data-${PACKAGE_NAME}-client`
const CHAT_NODE_SLOT = 'conversation.chat.node'
const MESSAGE_IMAGES_SLOT = 'conversation.message.images'
const CHAT_NS = 'chat'
const CONVERSATION_NS = 'conversation'
const REGISTRANT = `${PACKAGE_NAME}/client`
/** Below the stock renderer's priority 0; lowest renders, so this entry wins its cells. */
const SHADOW_PRIORITY = -100

type PatchableConversation = BridgeConversation & {
  [PATCH_MARKER]?: {
    readonly wrapped: BridgeConversation['sendSession']
  }
}

type ClientRemoteLike = SettingsCardApi

type MessageImageLoader = ((attachment: unknown) => Promise<string>) & {
  peek?: (attachment: unknown) => string | undefined
}

interface MessageImagesPropsLike extends Record<string, unknown> {
  readonly images: readonly unknown[]
  readonly loadImage: MessageImageLoader
  readonly align: 'start' | 'end'
}

/** One keyed chat-node slot render occurrence: the stock owner props plus the node. */
type ChatNodeProps = {
  node: { kind: string; data: { content?: readonly ChatContentBlock[] } }
  t?: (key: string, params?: Record<string, unknown>) => string
} & Record<string, unknown>

function isConversation(value: unknown): value is PatchableConversation {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  const conversation = value as Partial<BridgeConversation>
  return typeof conversation.sendSession === 'function'
    && typeof conversation.draftImages === 'function'
    && typeof conversation.releaseDraftImages === 'function'
}

function remoteService(value: unknown): ClientRemoteLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<ClientRemoteLike>
  if (candidate.settings === undefined || candidate.credentials === undefined) return undefined
  return typeof candidate.settings.describe === 'function'
    && typeof candidate.settings.mutate === 'function'
    && typeof candidate.credentials.describe === 'function'
    && typeof candidate.credentials.set === 'function'
    && typeof candidate.credentials.unset === 'function'
    ? value as ClientRemoteLike
    : undefined
}

/**
 * Cordis services are caller-traced proxies. Assigning a method on that proxy
 * creates a caller shadow rather than changing the root singleton used by the
 * composer. rc.2 exposes the canonical target through cordis.original; plain
 * test doubles and future untraced services fall back to the supplied value.
 */
function canonicalConversation(value: unknown): PatchableConversation | undefined {
  if (!isConversation(value)) return undefined
  const original = (value as unknown as Record<PropertyKey, unknown>)[CORDIS_ORIGINAL]
  return isConversation(original) ? original : value
}

function settingsScopeBinder(value: unknown): SettingsScopeBinderLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  return typeof (value as Partial<SettingsScopeBinderLike>).bind === 'function'
    ? value as SettingsScopeBinderLike
    : undefined
}

function localeService(value: unknown): LocaleServiceLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<LocaleServiceLike>
  return typeof candidate.register === 'function' && typeof candidate.bind === 'function'
    ? value as LocaleServiceLike
    : undefined
}

/**
 * The stock user/steering renderer this bundle shadows. Rendering with the
 * original component (same props) keeps every ordinary message pixel-identical
 * without this package importing React or restyling anything.
 */
function stockRendererFor(slots: SlotsServiceLike, key: string): ElementType | null | undefined {
  return slots
    .entries(CHAT_NODE_SLOT)
    .find((entry) => entry.options.key === key && !(entry.component as unknown as Record<PropertyKey, unknown>)[RENDER_MARKER])
    ?.component
}

function stockMessageImagesFor(slots: SlotsServiceLike): ElementType | null | undefined {
  return slots
    .entries(MESSAGE_IMAGES_SLOT)
    .find(entry => !(entry.component as unknown as Record<PropertyKey, unknown>)[IMAGE_RENDER_MARKER])
    ?.component
}

function bridgeAttachment(value: unknown): boolean {
  return value !== null && typeof value === 'object'
    && typeof (value as Record<PropertyKey, unknown>)[BRIDGE_REFERENCE_FIELD] === 'string'
}

/** Delegate the shipped gallery unchanged, replacing only its durable loader for bridge references. */
function bridgeMessageImagesRenderer(
  slots: SlotsServiceLike,
  historyImages: ReturnType<typeof createBridgeHistoryImageLoader>,
) {
  const render = (props: never): unknown => {
    const imageProps = props as unknown as MessageImagesPropsLike
    const stock = stockMessageImagesFor(slots)
    if (stock === undefined || stock === null) return null
    const nativeLoad = imageProps.loadImage
    const load: MessageImageLoader = (attachment) => bridgeAttachment(attachment)
      ? historyImages.load(attachment)
      : nativeLoad(attachment)
    load.peek = (attachment) => bridgeAttachment(attachment) ? undefined : nativeLoad.peek?.(attachment)
    return renderStock(stock, { ...imageProps, loadImage: load })
  }
  ;(render as unknown as Record<PropertyKey, unknown>)[IMAGE_RENDER_MARKER] = true
  return render
}

/**
 * Presentation upgrade for user rows whose durable text contains bridge
 * attachment links: re-express the links as the stock renderer's native image
 * attachment blocks (thumbnail gallery) and keep only the user's question in
 * the bubble. Every other row is rendered by the stock component verbatim.
 * The durable user turn and the model-facing text are never modified.
 */
function bridgeChatNodeRenderer(
  slots: SlotsServiceLike,
  key: string,
) {
  const render = (props: never): unknown => {
    const nodeProps = props as unknown as ChatNodeProps
    const content = nodeProps?.node?.data?.content
    if (!Array.isArray(content)) return stockRenderer(slots, key, props)
    const projection = projectBridgeContent(content)
    if (!projection.bridged) return stockRenderer(slots, key, props)
    const stock = stockRendererFor(slots, key)
    if (stock === undefined || stock === null) return null
    return renderStock(stock, {
      ...nodeProps,
      node: { ...nodeProps.node, data: { ...nodeProps.node.data, content: projection.content } },
    })
  }
  ;(render as unknown as Record<PropertyKey, unknown>)[RENDER_MARKER] = true
  return render
}

function renderStock(stock: ElementType, props: Record<string, unknown>): ReactElement {
  // The official renderer is React.memo(...), whose runtime value is an
  // exotic component object. It must be mounted as an element; invoking it
  // like a plain function crashes the slot and makes DSH abdicate to the
  // lower-priority stock renderer, exposing the durable attachment links.
  return createElement(stock, props)
}

function stockRenderer(slots: SlotsServiceLike, key: string, props: never): unknown {
  const stock = stockRendererFor(slots, key)
  if (stock === undefined || stock === null) return null
  return renderStock(stock, props as unknown as Record<string, unknown>)
}

/**
 * Register the presentation layer for user and steering rows. The stock
 * conversation package declares `conversation.chat.node` and occupies the
 * `user`/`steering` cells at priority 0; this entry registers at a lower
 * priority (lowest renders), so it shadows both cells for the plugin's
 * lifetime and restores them exactly on disposal. The entry declares the
 * chat locale namespace so the renderer injects the same `t` seat
 * the stock renderer relies on, which the projection passes through when it
 * delegates rendering back to the stock component.
 */
function registerChatNodePresentation(
  ctx: ClientContextLike,
  slots: SlotsServiceLike,
): void {
  const disposers = (['user', 'steering'] as const).map((key) =>
    slots.register(
      { name: CHAT_NODE_SLOT, key, priority: SHADOW_PRIORITY, locale: CHAT_NS, registrant: REGISTRANT },
      bridgeChatNodeRenderer(slots, key),
    ),
  )
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'vision-bridge: chat node presentation')
}

function registerMessageImagePresentation(
  _ctx: ClientContextLike,
  slots: SlotsServiceLike,
  historyImages: ReturnType<typeof createBridgeHistoryImageLoader>,
): void {
  slots.inject(MESSAGE_IMAGES_SLOT, () => slots.register(
    {
      name: MESSAGE_IMAGES_SLOT,
      priority: SHADOW_PRIORITY,
      locale: CONVERSATION_NS,
      registrant: REGISTRANT,
    },
    bridgeMessageImagesRenderer(slots, historyImages),
  )) as (() => void) | undefined
}

/** Contribute this namespace's own card to the official plugin configuration slot. */
function registerProviderSettingsCard(
  ctx: ClientContextLike,
  slots: SlotsServiceLike,
  settingsScope: SettingsScopeBinderLike,
  locale: LocaleServiceLike,
  api: SettingsCardApi,
): void {
  const scope = settingsScope.bind<VisionBridgeSettings>({ namespace: VISION_BRIDGE_SETTINGS_NAMESPACE })
  const fallbackT = locale.bind(SETTINGS_CARD_LOCALE_NAMESPACE)
  ctx.effect(
    () => locale.register(SETTINGS_CARD_LOCALE_NAMESPACE, settingsCardLocales),
    'vision-bridge: settings dictionaries',
  )
  slots.inject('settings.plugin.item', () => slots.register(
    {
      name: 'settings.plugin.item',
      key: VISION_BRIDGE_SETTINGS_NAMESPACE,
      locale: SETTINGS_CARD_LOCALE_NAMESPACE,
      registrant: REGISTRANT,
    },
    (slotProps: never) => {
      const injectedT = (slotProps as unknown as { readonly t?: (key: string) => string }).t
      return createElement(ProviderSettingsCard, {
        scope,
        api,
        t: (injectedT ?? fallbackT) as (key: Parameters<typeof fallbackT>[0]) => string,
      })
    },
  ))
}

function markActive(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const root = document.documentElement
  root.setAttribute(ACTIVE_ATTRIBUTE, 'active')
  return () => {
    if (root.getAttribute(ACTIVE_ATTRIBUTE) === 'active') root.removeAttribute(ACTIVE_ATTRIBUTE)
  }
}

/** Install the Web-only pasted-image admission bridge and history presentation. */
export function apply(ctx: ClientContextLike): void {
  const conversation = canonicalConversation(ctx.get('conversation'))
  if (conversation === undefined) {
    throw new Error('vision-bridge/client: incompatible conversation service; expected DSH 0.1.2-alpha.1')
  }
  const remote = remoteService(ctx.get('remote'))
  const slots = ctx.get('slots')
  if (slots === undefined || typeof (slots as SlotsServiceLike).register !== 'function'
    || typeof (slots as SlotsServiceLike).entries !== 'function'
    || typeof (slots as SlotsServiceLike).inject !== 'function') {
    throw new Error('vision-bridge/client: incompatible slots service; expected DSH 0.1.2-alpha.1')
  }
  const settingsScope = settingsScopeBinder(ctx.get('settingsScope'))
  if (settingsScope === undefined) {
    throw new Error('vision-bridge/client: incompatible settings scope; expected DSH 0.1.2-alpha.1')
  }
  const locale = localeService(ctx.get('locale'))
  if (locale === undefined) {
    throw new Error('vision-bridge/client: incompatible locale service; expected DSH 0.1.2-alpha.1')
  }
  if (remote === undefined) {
    throw new Error('vision-bridge/client: incompatible Remote service; expected DSH 0.1.2-alpha.1')
  }

  if (Object.hasOwn(conversation, PATCH_MARKER)) {
    throw new Error('vision-bridge/client: pasted-image bridge is already installed')
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(conversation, 'sendSession')
  const original = conversation.sendSession
  const bridge = createVisionBridgeSendSession(conversation)
  let active = true
  const wrapped: BridgeConversation['sendSession'] = (session, text, imageIds, mode, signal) => {
    if (!active) return original.call(conversation, session, text, imageIds, mode, signal)
    return bridge(session, text, imageIds, mode, signal)
  }
  const historyImages = createBridgeHistoryImageLoader()
  registerProviderSettingsCard(ctx, slots as SlotsServiceLike, settingsScope, locale, remote)
  conversation[PATCH_MARKER] = Object.freeze({ wrapped })
  conversation.sendSession = wrapped
  const clearActive = markActive()
  registerChatNodePresentation(ctx, slots as SlotsServiceLike)
  registerMessageImagePresentation(ctx, slots as SlotsServiceLike, historyImages)
  ctx.effect(() => () => {
    // An outer wrapper may still hold this function. Make such a reference an
    // inert pass-through before restoring the property when we remain on top.
    active = false
    if (conversation.sendSession === wrapped) {
      if (originalDescriptor === undefined) Reflect.deleteProperty(conversation, 'sendSession')
      else Object.defineProperty(conversation, 'sendSession', originalDescriptor)
    }
    delete conversation[PATCH_MARKER]
    historyImages.dispose()
    clearActive()
  }, 'vision-bridge: WebUI pasted-image bridge')
}

export {
  buildBridgePrompt,
  createVisionBridgeSendSession,
} from './bridge.js'
export {
  ATTACHMENT_LINK_LABEL,
  BRIDGE_REFERENCE_FIELD,
  projectBridgeContent,
} from './chat-render.js'
export { createBridgeHistoryImageLoader } from './image-loader.js'
export type {
  BridgeConversation,
  BridgeDraftAttachment,
  BridgeSession,
  BridgeSubmitMode,
  WebDraftUploadResponse,
  WebImageRoutingResponse,
} from './bridge.js'
export type { BridgeContentProjection, ChatContentBlock } from './chat-render.js'
