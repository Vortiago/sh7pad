import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/sh7pad/',
  server: process.env['PORT']
    ? { port: Number(process.env['PORT']), strictPort: true }
    : undefined,
  test: {
    globals: true,
    // Default environment is node. UI/DOM tests opt in via a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    // Vitest owns the unit/integration tier under src/test; Playwright owns
    // tests/e2e (driven by playwright.config.ts). Exclude the e2e tree so
    // `npm test` doesn't try to load `@playwright/test` in a Node context.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
  assetsInclude: ['**/*.sh7'],
});
