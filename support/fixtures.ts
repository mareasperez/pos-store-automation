import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

const authDir = path.join(__dirname, '..', 'playwright', '.auth');

/** Session files produced by `npm run test:auth:setup`, one per test cashier. */
function listAuthStateFiles(): string[] {
  if (!fs.existsSync(authDir)) return [];
  return fs
    .readdirSync(authDir)
    .filter((file) => /^user-\d+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((file) => path.join(authDir, file));
}

/**
 * Gives every worker its own cashier. Shifts are scoped per user in the backend, so distinct users
 * never fight over a till — while tenant-wide state (stock, sequences) stays shared on purpose,
 * which is exactly the production scenario of several cashiers billing at the same time.
 */
export const test = base.extend<object, { workerStorageState: string | undefined }>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workerStorageState: [
    async ({}, use, workerInfo) => {
      // Unauthenticated projects (@auth specs) must stay signed out.
      if (!workerInfo.project.use.storageState) {
        await use(undefined);
        return;
      }

      const stateFiles = listAuthStateFiles();
      if (!stateFiles.length) {
        throw new Error(
          `No auth state files found in ${authDir}. Run "npm run test:auth:setup" first.`
        );
      }

      if (workerInfo.config.workers > stateFiles.length) {
        console.warn(
          `[auth] ${workerInfo.config.workers} workers but only ${stateFiles.length} test users: ` +
            'some workers share a cashier and will contend over that shift.'
        );
      }

      await use(stateFiles[workerInfo.workerIndex % stateFiles.length]);
    },
    { scope: 'worker' },
  ],
});

export { expect };
