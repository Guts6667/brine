import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { hashPassword } from './lib/auth';

const testDirectory = path.resolve('test-results/auth');
const databasePath = path.join(testDirectory, 'brine.sqlite');

// These credentials are fixtures, never deployment credentials. Only this
// dedicated test database is reset, leaving the working database untouched.
mkdirSync(testDirectory, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(databasePath + suffix, { force: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth.spec.ts',
  metadata: { authenticationTests: true },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/auth-browser',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-auth', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --port 3200',
    url: 'http://127.0.0.1:3200/connexion',
    env: {
      BRINE_DB_PATH: databasePath,
      BRINE_PASSWORD_HASH: hashPassword('brine-browser-test-password'),
      BRINE_SESSION_SECRET: 'brine-browser-test-session-secret-at-least-32-characters',
      BRINE_APP_ORIGIN: 'http://127.0.0.1:3200',
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
      VERCEL: '',
      VERCEL_URL: '',
      VERCEL_PROJECT_PRODUCTION_URL: '',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
