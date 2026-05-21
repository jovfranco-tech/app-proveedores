import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-production',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://conectapro-mx.vercel.app',
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium-production', use: { ...devices['Desktop Chrome'] } }]
});
