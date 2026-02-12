import { test, expect } from '@playwright/test';
import { config } from '../utils/config';

test.describe('Login Flow', () => {
  const { username, password } = config.credentials;



  test('should login successfully with valid credentials', async ({ page }) => {
    await page.goto('/login');

    // Fill login form
    console.log('Logging in with:', username);
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard or home
    console.log('Waiting for URL /');
    try {
      await expect(page).toHaveURL('/', { timeout: 10000 });
      console.log('Login successful, URL is /');
    } catch (e) {
      console.log('Login failed or timed out. Current URL:', page.url());
      const errorVisible = await page.locator('#login-error').isVisible();
      console.log('Error message visible:', errorVisible);
      if (errorVisible) {
        console.log('Error text:', await page.locator('#login-error').innerText());
      }
      throw e;
    }
    // Check for a common element on the dashboard, e.g., a header or logout button
    // Based on App.tsx, successful login goes to / which redirects to dashboard or shows dashboard
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
