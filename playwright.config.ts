import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  webServer: {
    command: 'API_PORT=6174 VITE_DEV_PORT=6173 API_PROXY_TARGET=http://127.0.0.1:6174 RATE_LIMIT_MAX=1000 npm run dev',
    url: 'http://127.0.0.1:6174/api/health',
    reuseExistingServer: false,
    timeout: 120_000
  },
  use: {
    baseURL: 'http://127.0.0.1:6173',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } }
  ]
});
