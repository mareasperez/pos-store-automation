import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { config } from './utils/config';

const authStateFile = path.join(__dirname, 'playwright', '.auth', 'user.json');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 2,
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
