import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@config';

const authStateFile = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

setup('authenticate once and persist storage state', async ({ page }) => {
  setup.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run authenticated flows.'
  );

  fs.mkdirSync(path.dirname(authStateFile), { recursive: true });

  await page.goto('/login?lng=es', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"]').fill(config.credentials.username);
  await page.locator('input[name="password"]').fill(config.credentials.password);
  await page.locator('button[type="submit"]').click();

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });

  await page.context().storageState({ path: authStateFile });
});
