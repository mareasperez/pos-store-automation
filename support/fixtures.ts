import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { dirnameFromUrl } from '../utils/esm';

const dirname = dirnameFromUrl(import.meta.url);
const authDir = path.join(dirname, '..', 'playwright', '.auth');

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

  // Auto-attached to every test's page: makes intermittent 401s / hung requests / console errors
  // visible in the run output instead of only manifesting as an opaque "Test timeout exceeded".
  page: async ({ page }, use, testInfo) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[console error] ${testInfo.title}: ${msg.text()}`);
      }
    });
    page.on('requestfailed', (request) => {
      console.log(
        `[request failed] ${testInfo.title}: ${request.method()} ${request.url()} - ` +
          `${request.failure()?.errorText}`
      );
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log(
          `[http ${response.status()}] ${testInfo.title}: ${response.request().method()} ${response.url()}`
        );
      }
    });

    // Any non-auth test that ends up on /login lost its session mid-run (expired/invalid cookie,
    // wrong tenant, etc). Fail fast with a clear reason instead of timing out 2 minutes later on
    // some unrelated locator that will never appear because the app never left the login screen.
    const isAuthTest =
      /[\\/]tests[\\/]auth[\\/]/.test(testInfo.file) || /@auth\b/.test(testInfo.title);
    const loginRedirect = new Promise<never>((_, reject) => {
      if (isAuthTest) return;
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        let pathname: string;
        try {
          pathname = new URL(frame.url()).pathname;
        } catch {
          return;
        }
        if (pathname.startsWith('/login')) {
          reject(
            new Error(
              `Unexpected redirect to ${frame.url()} — the session was rejected mid-test ` +
                `(expired/invalid auth cookie, wrong tenant, etc). Re-run ` +
                `"npm run test:auth:setup" to refresh the saved session.`
            )
          );
        }
      });
    });

    await Promise.race([use(page), loginRedirect]);
  },

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

type DescribeBody = () => void;

export function parallelDescribe(title: string, body: DescribeBody): void {
  test.describe(`@parallel ${title}`, body);
}

export function serialDescribe(title: string, body: DescribeBody): void {
  test.describe(`@serial ${title}`, body);
}
