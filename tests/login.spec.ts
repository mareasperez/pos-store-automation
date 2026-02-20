import { test, expect } from '@playwright/test';
import { loginOrFail } from './utils/ui-flow';

test.describe('Login Flow', () => {
  test('should login successfully with valid credentials', async ({ page }) => {
    await loginOrFail(page);
    await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i);
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="username"]', 'invaliduser');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Expect error message
    // Based on LoginPage.tsx: <div id="login-error" ...>
    const errorLocator = page.locator('#login-error');
    await expect(errorLocator).toBeVisible();
    // precise text might depend on translation, but checking visibility is good start
  });
});
