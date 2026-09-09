import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { dirnameFromUrl } from './utils/esm';
import { config } from './utils/config';

const dirname = dirnameFromUrl(import.meta.url);
const authStateFile = path.join(dirname, 'playwright', '.auth', 'user.json');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 3,
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: config.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es',
    timezoneId: 'America/Managua',
    extraHTTPHeaders: {
      'Accept-Language': 'es',
    },
  },
  projects: [
    {
      // Serial-only tags (@shift-destructive, @receivables-destructive) are excluded from the
      // default suite via --grep-invert on the full-run npm scripts (not here) — project-level
      // grepInvert would AND-combine with the dedicated test:destructive:* scripts' --grep and
      // produce "no tests found".
      name: 'chromium-authenticated',
      grepInvert: /@auth/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authStateFile,
      },
    },
    {
      name: 'chromium-unauthenticated',
      grep: /@auth/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
