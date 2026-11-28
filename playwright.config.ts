import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { dirnameFromUrl } from './utils/esm';
import { config } from './utils/config';
import { getEnvironmentPaths } from './utils/environment-paths.mjs';

const dirname = dirnameFromUrl(import.meta.url);
const environmentPaths = getEnvironmentPaths(config.environment);
const authStateFile = path.resolve(dirname, environmentPaths.authStateFile(0));

export default defineConfig({
  testDir: './tests',
  globalSetup: './scripts/global-setup.mjs',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 3,
  outputDir: environmentPaths.outputDir,
  // 'json' persists a durable, greppable summary of the last run (which tests failed and why)
  // independent of the environment-specific HTML report.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: environmentPaths.htmlReportDir }],
    [
      'json',
      {
        outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? environmentPaths.jsonResultsFile,
      },
    ],
  ],
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
