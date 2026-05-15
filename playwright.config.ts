import { defineConfig, devices } from '@playwright/test';

// E2E config — runs against a Vite dev server that Playwright auto-starts.
// Vitest still owns the unit/integration tier; this layer covers user-visible
// flows the unit tests can't exercise (real DOM, real navigation, real localStorage).

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173/sh7pad/',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/sh7pad/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
