import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The real package is a DSH Web platform module whose CSS is installed by
    // the host. Node-only unit tests use a no-DOM facade; packed Web boot still
    // loads the actual platform module.
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': new URL(
        './tests/stubs/dsh-client-ui-primitives.ts', import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    restoreMocks: true,
  },
})
