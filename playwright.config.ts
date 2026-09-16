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
  // 'json' persists a durable, greppable summary of the last run (which tests failed and why)
  // independent of the HTML report, so it survives even if the next run overwrites playwright-report/.
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results.json' }]],
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
      // Execution groups are selected explicitly by the npm scripts with @parallel or @serial;
      // project-level grep would combine with those filters and could produce "no tests found".
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
