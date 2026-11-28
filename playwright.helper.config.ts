import { defineConfig, devices } from '@playwright/test';
import { getEnvironmentPaths } from './utils/environment-paths.mjs';

const storageState = { cookies: [], origins: [] };
const environmentPaths = getEnvironmentPaths(process.env.E2E_ENV || 'local');

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/helpers/*-helper.spec.ts', '**/helpers/target.flow.spec.ts'],
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  outputDir: `${environmentPaths.outputDir}/readiness-isolated`,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'https://ui.example.invalid',
    storageState,
    locale: 'es',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium-authenticated',
      use: { ...devices['Desktop Chrome'], storageState },
    },
  ],
});
