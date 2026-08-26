import type { UserConfig } from 'tsdown'

// The browser loader banner is parsed before package code executes; keep this
// build-time mirror covered by scripts/verify-package.mjs.
const PACKAGE_NAME = 'dsh-open-eyes'

const config: UserConfig = {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  // Both are DSH Web platform seed words. Keeping the official primitives
  // external reuses the host's exact components and CSS instead of bundling a
  // second UI implementation.
  deps: { neverBundle: ['react', '@deepseek-ai/dsh-client-ui-primitives'] },
  dts: false,
  sourcemap: false,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default config
