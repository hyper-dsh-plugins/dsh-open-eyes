import { access, readFile, readdir } from 'node:fs/promises'
import { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from '../lib/package-name.js'

const required = [
  'lib/index.js',
  'lib/index.d.ts',
  'lib/skill.js',
  'lib/skill.d.ts',
  'lib/client.js',
  'lib/client/index.d.ts',
  'assets/dsh-open-eyes.png',
  'skills/vision-bridge/SKILL.md',
  'skills/vision-bridge/references/usage.md',
  'skills/vision-bridge/references/security.md',
  'cordis.patch.yml',
]

await Promise.all(required.map((path) => access(new URL(`../${path}`, import.meta.url))))

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    return entry.isDirectory() ? await walk(url) : [url]
  }))).flat()
}

const builtFiles = await walk(new URL('../lib/', import.meta.url))
if (builtFiles.some((url) => url.pathname.endsWith('.map'))) {
  throw new Error('production lib must not contain source-map artifacts')
}

const [manifestText, clientBundle, readme, readmeZh] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../lib/client.js', import.meta.url), 'utf8'),
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
  readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8'),
])
const manifest = JSON.parse(manifestText)
if (manifest.name !== PACKAGE_NAME || manifest.version !== '0.1.2-rc.1') {
  throw new Error('unexpected package identity')
}
if (manifest.license !== 'MIT' || manifest.repository?.url !== 'git+https://github.com/Hyp6666/dsh-open-eyes.git') {
  throw new Error('license or repository metadata is not release-ready')
}
if (!readme.includes('href="./README.zh-CN.md">中文</a>') || !readme.includes('src="./assets/dsh-open-eyes.png"')) {
  throw new Error('English README must link to 中文 and render the packaged project artwork')
}
if (!readmeZh.includes('href="./README.md">English</a>') || !readmeZh.includes('src="./assets/dsh-open-eyes.png"')) {
  throw new Error('Chinese README must link back to the English default and render the packaged project artwork')
}
if (!manifest.files?.includes('assets/dsh-open-eyes.png')) {
  throw new Error('README artwork is missing from the npm files allowlist')
}
for (const repositoryOnlyPath of ['src/', 'tests/', '.github/', 'docs/', 'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md']) {
  if (manifest.files?.includes(repositoryOnlyPath)) {
    throw new Error(`repository-only path must not be published: ${repositoryOnlyPath}`)
  }
}
if (PACKAGE_NAME_AVAILABLE !== true || manifest.scripts?.prepublishOnly !== 'node scripts/verify-publish-name.mjs') {
  throw new Error('npm package identity is not release-ready')
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('missing dsh.bundle.patch')
}
if (manifest.dsh?.client?.platform !== 'web' || manifest.exports?.['./client'] === undefined) {
  throw new Error('missing dsh.client Web bundle declaration')
}
const expectedClientInject = [
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
]
if (JSON.stringify(manifest.dsh?.client?.inject) !== JSON.stringify(expectedClientInject)) {
  throw new Error('Web client inject list must match the DSH 0.1.2-rc.1 Remote/UI services')
}
if (manifest.peerDependencies?.react !== '^18.2.0' || !clientBundle.includes('require("react")')) {
  throw new Error('Web client must reuse the DSH React runtime instead of bundling a private copy')
}
const clientRequires = [...clientBundle.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1])
const supportedClientRequires = new Set(['react', '@deepseek-ai/dsh-client-ui-primitives'])
const unsupportedClientRequires = [...new Set(clientRequires.filter(name => !supportedClientRequires.has(name)))]
if (unsupportedClientRequires.length > 0) {
  throw new Error(`Web client imports unsupported runtime modules: ${unsupportedClientRequires.join(', ')}`)
}
if (!clientBundle.includes(`id: "${PACKAGE_NAME}"`) || !clientBundle.includes(`const PACKAGE_NAME = "${PACKAGE_NAME}"`)) {
  throw new Error('Web client module identity does not match PACKAGE_NAME')
}
if (!clientBundle.includes('react.createElement)(stock, props)')) {
  throw new Error('Web client must mount the stock React renderer as an element')
}
if (!clientBundle.includes('/vision-bridge/v1/web-attachment')) {
  throw new Error('Web client is missing the session-authorized history image reader')
}
if (!clientBundle.includes('/vision-bridge/v1/provider-validation')) {
  throw new Error('Web client is missing the saved-provider validation request')
}
if (!clientBundle.includes('/vision-bridge/v1/provider-models')) {
  throw new Error('Web client is missing provider model discovery')
}
if (!clientBundle.includes('require("@deepseek-ai/dsh-client-ui-primitives")')) {
  throw new Error('Web client must reuse the DSH-native UI primitives')
}
if (!clientBundle.includes('settings.plugin.item') || !clientBundle.includes('vision-bridge: settings dictionaries')) {
  throw new Error('Web client is missing the plugin configuration card registration')
}
if (!clientBundle.includes('credentials.set') || !clientBundle.includes('settings.mutate')) {
  throw new Error('Web client is missing the separated settings and credential write seams')
}
if (!clientBundle.includes('conversation.message.images') || !clientBundle.includes('beginSubmission')) {
  throw new Error('Web client is missing the rc.1 image renderer or immediate-echo seam')
}
if (clientBundle.includes('connection.api')) {
  throw new Error('Web client must not use the removed connection.api transport')
}
