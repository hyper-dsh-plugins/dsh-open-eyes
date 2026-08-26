import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from '../src/package-name.js'

describe('publish metadata for the Web client half', () => {
  it('declares the official dsh.client surface and release allowlist', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string
      version: string
      exports: Record<string, unknown>
      dsh: { client?: { platform?: string; inject?: string[] } }
      files: string[]
      peerDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(manifest.version).toBe('0.1.1-rc.2')
    expect(manifest.name).toBe(PACKAGE_NAME)
    expect(PACKAGE_NAME_AVAILABLE).toBe(true)
    expect(manifest.scripts.prepublishOnly).toBe('node scripts/verify-publish-name.mjs')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.dsh.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-connection',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-ui-settings-plugins',
      ],
    })
    expect(manifest.files).toContain('lib/')
    expect(manifest.files).toContain('assets/dsh-open-eyes.png')
    expect(manifest.peerDependencies.react).toBe('^18.2.0')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-settings']).toBe('0.1.1-rc.2')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-settings-plugins']).toBe('0.1.1-rc.2')
    expect(manifest.scripts.build).toContain('tsdown')
  })
})
