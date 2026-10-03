import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const databasePath = path.resolve('test-results/e2e/brine.sqlite');

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'auth.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/browser',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/reset-database.mjs && npm run dev -- --port 3100',
    url: 'http://127.0.0.1:3100',
    env: { BRINE_DB_PATH: databasePath, NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
