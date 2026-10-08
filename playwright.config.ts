import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const databasePath = path.resolve('test-results/e2e/brine.sqlite');
const port = Number(process.env.BRINE_E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;

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
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node e2e/reset-database.mjs && npm run start -- --port ${port}`,
    url: baseURL,
    env: { BRINE_DB_PATH: databasePath, NEXT_TELEMETRY_DISABLED: '1', BRINE_TEST_FIXTURES:'1', WORKFLOW_LOCAL_DATA_DIR:path.resolve('test-results/workflows'), WORKFLOW_LOCAL_BASE_URL:baseURL },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
