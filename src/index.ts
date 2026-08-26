import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { Config as ConfigSchema, validateConfig } from './config.js'
import type { Config as VisionBridgeConfig } from './config.js'
import { createVisionTool } from './tool.js'
import { SessionEnablement } from './session-enablement.js'
import { discoverProviderModelsForDraft, validateProviderConnection } from './provider-validation.js'
import {
  resolveConfigFromSettings,
  settingsBaseFromConfig,
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  VisionBridgeSettingsSchema,
} from './settings.js'
import {
  createWebAttachmentHandler,
  createWebDraftHandler,
  createWebImageRouteHandler,
  createWebProviderModelsHandler,
  createWebProviderValidationHandler,
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
  WEB_PROVIDER_MODELS_ENDPOINT,
  WEB_PROVIDER_VALIDATION_ENDPOINT,
} from './web-draft.js'

export const name = 'vision-bridge'
export const inject = ['tools', 'credentials', 'fs', 'attachments']

export interface Config extends VisionBridgeConfig {}
export const Config = ConfigSchema

export function apply(ctx: Context, config: Config) {
  let resolved = validateConfig(config)
  const settingsBase = settingsBaseFromConfig(config)
  let settingsSource = () => settingsBase
  const enablement = new SessionEnablement(() => settingsSource())
  const refreshConfig = (): void => {
    resolved = resolveConfigFromSettings(config, settingsSource())
  }
  installSettingsSection(ctx, VISION_BRIDGE_SETTINGS_NAMESPACE, VisionBridgeSettingsSchema, settingsBase, {
    setSource(source) {
      settingsSource = source
    },
    onChange: refreshConfig,
    validate(settings) {
      resolveConfigFromSettings(config, settings)
    },
  })
  ctx.on('agent/session-start', ({ agent, source }) => {
    enablement.onSessionStart(agent.session, source)
  })
  ctx.inject(['webServer', 'sessions'], (webCtx) => {
    const services = webCtx as Context & {
      webServer: { register(route: { kind: 'exact'; path: string; handler: ReturnType<typeof createWebDraftHandler> }): () => void }
      sessions: { get(sessionId: string): { readonly events: readonly unknown[]; readonly header: { readonly createdAt: number } } | undefined }
    }
    const hasSession = (sessionId: string) => services.sessions.get(sessionId) !== undefined
    const disposeAttachments = services.webServer.register({
      kind: 'exact',
      path: WEB_ATTACHMENT_ENDPOINT,
      handler: createWebAttachmentHandler({
        attachments: webCtx.attachments,
        session: sessionId => services.sessions.get(sessionId),
      }),
    })
    const disposeDrafts = services.webServer.register({
      kind: 'exact',
      path: WEB_DRAFT_ENDPOINT,
      handler: createWebDraftHandler({
        attachments: webCtx.attachments,
        // The official SessionStore contains newly materialized conversations
        // before their first successful prompt. Agents only contains live
        // agent loops, so it cannot authorize a text-only route's first image.
        hasSession,
        isEnabled: sessionId => enablement.isEnabled(services.sessions.get(sessionId)),
        config: () => resolved,
      }),
    })
    const disposeRouting = services.webServer.register({
      kind: 'exact',
      path: WEB_IMAGE_ROUTE_ENDPOINT,
      handler: createWebImageRouteHandler({
        isEnabled: sessionId => {
          const session = services.sessions.get(sessionId)
          return session === undefined ? undefined : enablement.isEnabled(session)
        },
        config: () => resolved,
      }),
    })
    const disposeValidation = services.webServer.register({
      kind: 'exact',
      path: WEB_PROVIDER_VALIDATION_ENDPOINT,
      handler: createWebProviderValidationHandler({
        validate: (providerId, signal) => validateProviderConnection(webCtx, resolved, providerId, signal),
      }),
    })
    const disposeModels = services.webServer.register({
      kind: 'exact',
      path: WEB_PROVIDER_MODELS_ENDPOINT,
      handler: createWebProviderModelsHandler({
        models: (draft, signal) => discoverProviderModelsForDraft(webCtx, resolved, draft, signal),
      }),
    })
    return () => {
      disposeModels()
      disposeValidation()
      disposeRouting()
      disposeDrafts()
      disposeAttachments()
    }
  })
  return ctx.tools.register(createVisionTool(ctx, () => resolved, exec => {
    const session = exec.agent?.session
    return session === undefined ? false : enablement.isEnabled(session)
  }))
}

export { VisionBridgeError, VISION_ERROR_CODES } from './errors.js'
export type { VisionErrorCode } from './errors.js'
export type { VisionAnalyzeResult } from './result.js'
export type { AuthMode, JsonValue, Protocol, ProviderConfig } from './config.js'
export {
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
  WEB_PROVIDER_MODELS_ENDPOINT,
  WEB_PROVIDER_VALIDATION_ENDPOINT,
} from './web-draft.js'
export { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from './package-name.js'
export {
  credentialReferenceForProfile,
  isModelDiscoveryCredentialReferenceForProfile,
  modelDiscoveryCredentialReferenceForProfile,
  settingsBaseFromConfig,
  VISION_BRIDGE_SETTINGS_NAMESPACE,
  VisionBridgeSettingsSchema,
} from './settings.js'
export type { VisionBridgeProviderProfile, VisionBridgeSettings } from './settings.js'
