import { Context, Service } from '@deepseek-ai/cordis'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as VisionBridge from '../src/index.js'
import {
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
  WEB_PROVIDER_VALIDATION_ENDPOINT,
} from '../src/web-draft.js'
import { VISION_BRIDGE_SETTINGS_NAMESPACE } from '../src/settings.js'

class FakeTools extends Service {
  readonly definitions = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: ToolDefinition) {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      return () => this.definitions.delete(definition.name)
    }, 'fake-tools.register()')
  }
}

class EmptyService extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name)
  }
}

class FakeWebServer extends Service {
  readonly routes = new Map<string, { kind: 'exact'; path: string; handler: unknown }>()

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: { kind: 'exact'; path: string; handler: unknown }) {
    if (this.routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`)
    this.routes.set(route.path, route)
    return () => this.routes.delete(route.path)
  }
}

class FakeSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  get(sessionId: string) {
    return sessionId === 'session-1' ? { id: sessionId, events: [] } : undefined
  }
}

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private data: Record<string, unknown> = {}

  protected async load(): Promise<Record<string, unknown>> {
    return structuredClone(this.data)
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.data[String(ns)] = structuredClone(section)
  }
}

function service(name: string) {
  return class extends EmptyService {
    constructor(ctx: Context) {
      super(ctx, name)
    }
  }
}

describe('Cordis lifecycle', () => {
  it('registers once, reloads without duplicates, removes on dispose, and schedules no background timer', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const toolService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeTools(pluginCtx) } })
    const credentialService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('credentials'))(pluginCtx) } })
    const fsService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('fs'))(pluginCtx) } })
    const attachmentService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('attachments'))(pluginCtx) } })
    const webService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeWebServer(pluginCtx) } })
    const sessionService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeSessions(pluginCtx) } })
    const tools = (ctx as unknown as { tools: FakeTools }).tools
    const webServer = (ctx as unknown as { webServer: FakeWebServer }).webServer

    const first = await ctx.plugin(VisionBridge, VisionBridge.Config({}))
    expect(tools.definitions.has('vision_analyze')).toBe(true)
    expect(tools.definitions.size).toBe(1)
    expect(webServer.routes.has(WEB_DRAFT_ENDPOINT)).toBe(true)
    expect(webServer.routes.has(WEB_IMAGE_ROUTE_ENDPOINT)).toBe(true)
    expect(webServer.routes.has(WEB_ATTACHMENT_ENDPOINT)).toBe(true)
    expect(webServer.routes.has(WEB_PROVIDER_VALIDATION_ENDPOINT)).toBe(true)
    expect(webServer.routes.has('/vision-bridge/v1/provider-models')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    await first.dispose()
    expect(tools.definitions.has('vision_analyze')).toBe(false)
    expect(webServer.routes.has(WEB_DRAFT_ENDPOINT)).toBe(false)
    expect(webServer.routes.has(WEB_IMAGE_ROUTE_ENDPOINT)).toBe(false)
    expect(webServer.routes.has(WEB_ATTACHMENT_ENDPOINT)).toBe(false)
    expect(webServer.routes.has(WEB_PROVIDER_VALIDATION_ENDPOINT)).toBe(false)
    expect(webServer.routes.has('/vision-bridge/v1/provider-models')).toBe(false)

    const second = await ctx.plugin(VisionBridge, VisionBridge.Config({}))
    expect(tools.definitions.size).toBe(1)
    expect(webServer.routes.size).toBe(5)
    await second.dispose()
    expect(tools.definitions.size).toBe(0)
    expect(webServer.routes.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    await attachmentService.dispose()
    await sessionService.dispose()
    await webService.dispose()
    await fsService.dispose()
    await credentialService.dispose()
    await toolService.dispose()
    vi.useRealTimers()
  })

  it('registers a safe settings namespace and keeps one live-config tool identity', async () => {
    const ctx = new Context()
    const toolService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeTools(pluginCtx) } })
    const credentialService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('credentials'))(pluginCtx) } })
    const fsService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('fs'))(pluginCtx) } })
    const attachmentService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('attachments'))(pluginCtx) } })
    const webService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeWebServer(pluginCtx) } })
    const sessionService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeSessions(pluginCtx) } })
    const settingsService = await ctx.plugin({ apply(pluginCtx: Context) { new MemorySettings(pluginCtx) } })
    const tools = (ctx as unknown as { tools: FakeTools }).tools
    const settings = (ctx as unknown as { settings: MemorySettings }).settings

    const bridge = await ctx.plugin(VisionBridge, VisionBridge.Config({}))
    const descriptor = settings.describe({ redactSecrets: true })
      .find(row => row.ns === VISION_BRIDGE_SETTINGS_NAMESPACE)
    expect(descriptor).toBeDefined()
    expect(JSON.stringify(descriptor)).not.toContain('apiKey')
    const registered = tools.definitions.get('vision_analyze')
    expect(registered).toBeDefined()

    await settings.replace(VISION_BRIDGE_SETTINGS_NAMESPACE, {
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
    await vi.waitFor(() => expect(settings.get(VISION_BRIDGE_SETTINGS_NAMESPACE)).toMatchObject({ defaultProvider: 'primary' }))
    expect(tools.definitions.get('vision_analyze')).toBe(registered)

    const currentSettings = settings.get(VISION_BRIDGE_SETTINGS_NAMESPACE) as Record<string, unknown>
    await settings.replace(VISION_BRIDGE_SETTINGS_NAMESPACE, {
      ...currentSettings,
      enabled: false,
      enablementHistory: [
        { effectiveAt: 0, enabled: true },
        { effectiveAt: 1, enabled: false },
      ],
    })
    await vi.waitFor(() => expect(settings.get(VISION_BRIDGE_SETTINGS_NAMESPACE)).toMatchObject({ enabled: false }))
    expect(tools.definitions.get('vision_analyze')).toBe(registered)

    await bridge.dispose()
    expect(settings.describe().map(row => row.ns)).not.toContain(VISION_BRIDGE_SETTINGS_NAMESPACE)

    await settingsService.dispose()
    await attachmentService.dispose()
    await sessionService.dispose()
    await webService.dispose()
    await fsService.dispose()
    await credentialService.dispose()
    await toolService.dispose()
  })
})
