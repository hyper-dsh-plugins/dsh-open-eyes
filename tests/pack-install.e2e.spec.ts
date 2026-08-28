import { execFile, spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const enabled = process.env.DSH_PACK_E2E === '1'
const suite = enabled ? describe : describe.skip
const dshExecutable = path.resolve(process.env.DSH_E2E_BIN ?? 'node_modules/.bin/dsh')

suite('packed package install in an isolated DSH web profile', () => {
  let root: string
  let dshHome: string
  let tarball: string
  let tarEntries: string[]
  let web: ChildProcessWithoutNullStreams | undefined

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dsh-open-eyes-e2e-'))
    dshHome = path.join(root, 'dsh-home')
    const { stdout } = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], {
      cwd: new URL('..', import.meta.url),
      maxBuffer: 10 * 1024 * 1024,
    })
    const packed = JSON.parse(stdout) as Array<{ filename: string }>
    tarball = path.join(root, packed[0]!.filename)
    const listing = await run('tar', ['-tzf', tarball], { maxBuffer: 10 * 1024 * 1024 })
    tarEntries = listing.stdout.trim().split('\n')
  })

  afterAll(async () => {
    if (web !== undefined && web.exitCode === null) {
      web.kill('SIGINT')
      await onceExit(web)
    }
    if (root) await rm(root, { recursive: true, force: true })
  })

  function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => child.once('exit', () => resolve()))
  }

  async function startWeb(dsh: string, environment: NodeJS.ProcessEnv): Promise<{ origin: string; cookie: string }> {
    web = spawn(dsh, ['--profile', 'web', '--port', '0'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const launchUrl = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`timed out starting packed Web profile: ${output}`)), 30_000)
      const finish = (error: Error | undefined, origin?: string): void => {
        clearTimeout(timer)
        if (error !== undefined) reject(error)
        else resolve(origin!)
      }
      web!.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (match?.[1] !== undefined) finish(undefined, match[1])
      })
      web!.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
      web!.once('exit', code => finish(new Error(`packed Web profile exited early (${String(code)}): ${output}`)))
      web!.once('error', error => finish(error))
    })
    const exchange = await fetch(launchUrl, { redirect: 'manual' })
    expect(exchange.status).toBe(303)
    const setCookie = exchange.headers.get('set-cookie')
    if (setCookie === null) throw new Error('packed Web profile omitted its authentication cookie')
    return { origin: new URL(launchUrl).origin, cookie: setCookie.split(';', 1)[0]! }
  }

  async function stopWeb(): Promise<void> {
    const activeWeb = web
    if (activeWeb === undefined) return
    if (activeWeb.exitCode === null) {
      activeWeb.kill('SIGINT')
      await onceExit(activeWeb)
    }
    web = undefined
  }

  it('contains only the release allowlist and every runtime asset', async () => {
    expect(tarEntries).toContain('package/lib/index.js')
    expect(tarEntries).toContain('package/lib/skill.js')
    expect(tarEntries).toContain('package/lib/client.js')
    expect(tarEntries).toContain('package/lib/client/index.d.ts')
    expect(tarEntries).toContain('package/assets/dsh-open-eyes.png')
    expect(tarEntries).toContain('package/cordis.patch.yml')
    expect(tarEntries).toContain('package/skills/vision-bridge/SKILL.md')
    expect(tarEntries).toContain('package/skills/vision-bridge/references/usage.md')
    expect(tarEntries).toContain('package/skills/vision-bridge/references/security.md')
    expect(tarEntries.some((entry) => entry.includes('src/'))).toBe(false)
    expect(tarEntries.some((entry) => entry.includes('tests/'))).toBe(false)
    expect(tarEntries.some((entry) => entry.includes('.env'))).toBe(false)
    expect(tarEntries.some((entry) => entry.startsWith('package/docs/'))).toBe(false)
    expect(tarEntries).not.toContain('package/AGENTS.md')
    expect(tarEntries).not.toContain('package/CONTRIBUTING.md')
    expect(tarEntries).not.toContain('package/SECURITY.md')
  })

  it('adds both rows, dumps them, removes the package, and leaves neither row', async () => {
    const dsh = dshExecutable
    const environment = { ...process.env, DSH_HOME: dshHome }
    await run(dsh, ['plugin', '--profile', 'web', 'add', tarball, '--config.auto-install-peers=false'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      maxBuffer: 20 * 1024 * 1024,
    })
    const installed = await run(dsh, ['--profile', 'web', '--dump-config'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      maxBuffer: 20 * 1024 * 1024,
    })
    expect(installed.stdout).toContain('id: vision-bridge')
    expect(installed.stdout).toContain('id: vision-bridge-skill')
    expect(installed.stdout).toMatch(/^\s*name: ['"]?dsh-open-eyes['"]?\s*$/mu)
    expect(installed.stdout).toMatch(/^\s*name: ['"]?dsh-open-eyes\/skill['"]?\s*$/mu)

    const { origin, cookie } = await startWeb(dsh, environment)
    const authenticated = { headers: { cookie } }
    const index = await fetch(`${origin}/`, authenticated)
    expect(index.status).toBe(200)
    const html = await index.text()
    const graphText = /globalThis\["__DSH_BOOT__"\] = (\{[^\n<]+\})<\/script>/u.exec(html)?.[1]
    expect(graphText).toBeDefined()
    const graph = JSON.parse(graphText!) as { entries: Array<{ id: string; url: string; inject?: string[] }> }
    const openEyesEntry = graph.entries.find(entry => entry.id === 'dsh-open-eyes')
    expect(openEyesEntry?.inject).toEqual([
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-chat',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-plugins',
    ])
    expect(openEyesEntry?.url).toBeDefined()
    const bundle = await fetch(new URL(openEyesEntry!.url, origin), authenticated)
    expect(bundle.status).toBe(200)
    const bundleText = await bundle.text()
    expect(bundleText).toContain('id: "dsh-open-eyes"')
    expect(bundleText).toContain('/vision-bridge/v1/web-image-route')
    expect(bundleText).toContain('/vision-bridge/v1/web-attachment')
    expect(bundleText).toContain('/vision-bridge/v1/provider-validation')
    expect(bundleText).toContain('/vision-bridge/v1/provider-models')
    expect(bundleText).toContain('Attached image')
    expect(bundleText).toContain('require("react")')
    expect(bundleText).toContain('react.createElement)(stock, props)')
    expect(bundleText).toContain('settings.plugin.item')
    expect(bundleText).toContain('conversation.message.images')
    expect(bundleText).toContain('beginSubmission')
    expect(bundleText).toContain('credentials.set')
    expect(bundleText).not.toContain('connection.api')
    expect(bundleText).not.toContain('conversation.resolveImage')
    expect([...bundleText.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1])).toEqual([
      'react',
      '@deepseek-ai/dsh-client-ui-primitives',
    ])
    expect(bundleText).not.toContain('Vision Bridge WebUI handoff')
    expect(bundleText).not.toContain('node:fs')
    const bridgeRoute = await fetch(`${origin}/vision-bridge/v1/web-drafts`, authenticated)
    expect(bridgeRoute.status).toBe(405)
    const capabilityRoute = await fetch(`${origin}/vision-bridge/v1/web-image-route`, authenticated)
    expect(capabilityRoute.status).toBe(405)
    const attachmentRoute = await fetch(`${origin}/vision-bridge/v1/web-attachment`, authenticated)
    expect(attachmentRoute.status).toBe(405)
    const validationRoute = await fetch(`${origin}/vision-bridge/v1/provider-validation`, authenticated)
    expect(validationRoute.status).toBe(405)
    const modelsRoute = await fetch(`${origin}/vision-bridge/v1/provider-models`, authenticated)
    expect(modelsRoute.status).toBe(405)

    await stopWeb()

    await run(dsh, ['plugin', '--profile', 'web', 'remove', 'dsh-open-eyes'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      maxBuffer: 20 * 1024 * 1024,
    })
    const removed = await run(dsh, ['--profile', 'web', '--dump-config'], {
      cwd: new URL('..', import.meta.url),
      env: environment,
      maxBuffer: 20 * 1024 * 1024,
    })
    expect(removed.stdout).not.toContain('id: vision-bridge')
    expect(removed.stdout).not.toContain('id: vision-bridge-skill')

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
    expect(manifest.name).toBe('dsh-open-eyes')
    expect(manifest).toMatchObject({
      dsh: {
        client: {
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
        },
      },
    })
  }, 120_000)

})
