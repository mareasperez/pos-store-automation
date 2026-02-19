import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { UI_TIMEOUT } from '@utils/ui-flow';

export async function loginOrFail(page: Page) {
  // Capture browser console logs for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`PAGE ERROR: ${msg.text()}`);
  });

  // Ensure Spanish is set before any JS loads
  await page.addInitScript(() => {
    // Aggressive locale mocking
    Object.defineProperty(navigator, 'languages', { get: () => ['es'] });
    Object.defineProperty(navigator, 'language', { get: () => 'es' });
    
    window.localStorage.setItem('i18nextLng', 'es');
    try {
      const storage = window.localStorage.getItem('pos_ui_storage');
      const esState = { language: 'es' };
      if (storage) {
        const parsed = JSON.parse(storage);
        if (parsed.state) {
          parsed.state.language = 'es';
          window.localStorage.setItem('pos_ui_storage', JSON.stringify(parsed));
        }
      } else {
        window.localStorage.setItem('pos_ui_storage', JSON.stringify({
          state: esState,
          version: 0
        }));
      }
    } catch (e) {
      // ignore
    }
  });

  await page.goto('/login?lng=es');
  
  // Force cookie as fallback for every navigation
  await page.context().addCookies([{
    name: 'i18next',
    value: 'es',
    domain: 'localhost',
    path: '/'
  }]);

  await page.context().addCookies([{
    name: 'i18nextLng',
    value: 'es',
    domain: 'localhost',
    path: '/'
  }]);
  
  // Wait for cold start loader if present
  const loader = page.locator('.cold-start-loader');
  if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Cold start loader detected, waiting for it to disappear...');
    await loader.waitFor({ state: 'detached', timeout: UI_TIMEOUT });
  }

  await page.fill('input[name="username"]', config.credentials.username);
  await page.fill('input[name="password"]', config.credentials.password);
  await page.click('button[type="submit"]');

  const loginError = page.locator('#login-error');

  const loginResult = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: UI_TIMEOUT,
        waitUntil: 'domcontentloaded',
      })
      .then(() => 'navigated' as const),
    loginError
      .waitFor({ state: 'visible', timeout: UI_TIMEOUT })
      .then(() => 'error' as const)
      .catch(() => 'timeout' as const),
  ]);

  if (loginResult !== 'navigated') {
    const errorText = (await loginError.textContent().catch(() => null))?.trim() || 'no detail';
    console.log(`Login failed. Current URL: ${page.url()}`);
    throw new Error(
      `Login did not complete. Check TEST_USERNAME/TEST_PASSWORD in automation/.env or root .env. UI error: ${errorText}`
    );
  }

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: UI_TIMEOUT });
}
