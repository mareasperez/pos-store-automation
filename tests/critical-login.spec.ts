import { expect, test } from '@playwright/test';
import { config } from '@config';

test('@critical @manual @auth valid user can log in', async ({ page }) => {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run @critical auth flows.'
  );

  await page.goto('/login?lng=es', { waitUntil: 'domcontentloaded' });

  await page.locator('input[name="username"]').fill(config.credentials.username);
  await page.locator('input[name="password"]').fill(config.credentials.password);
  await page.locator('button[type="submit"]').click();

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });

  const root = page.locator('#root');
  await expect(root).not.toBeEmpty();
});

test('@critical @manual @auth invalid user is rejected', async ({ page }) => {
  await page.goto('/login?lng=es', { waitUntil: 'domcontentloaded' });

  const invalidUser = `e2e.invalid.${Date.now()}`;
  await page.locator('input[name="username"]').fill(invalidUser);
  await page.locator('input[name="password"]').fill('invalid-password');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });

  const loginError = page.locator('#login-error');
  const hasVisibleErrorMessage = await loginError.isVisible().catch(() => false);

  if (hasVisibleErrorMessage) {
    await expect(loginError).toBeVisible();
  } else {
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  }
});
