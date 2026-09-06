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
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(manifest.version).toBe('0.1.2-rc.1')
    expect(manifest.name).toBe(PACKAGE_NAME)
    expect(PACKAGE_NAME_AVAILABLE).toBe(true)
    expect(manifest.scripts.prepublishOnly).toBe('node scripts/verify-publish-name.mjs')
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.dsh.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-chat',
        '@deepseek-ai/dsh-client-ui-conversation',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-ui-settings-plugins',
      ],
    })
    expect(manifest.files).toContain('lib/')
    expect(manifest.files).toContain('assets/dsh-open-eyes.png')
    expect(manifest.peerDependencies.react).toBe('^18.2.0')
    for (const [name, version] of Object.entries({
      ...manifest.peerDependencies,
      ...manifest.devDependencies,
    })) {
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
        expect(version, name).toBe('0.1.2-rc.1')
      }
    }
    expect(manifest.scripts.build).toContain('tsdown')
  })
})
