import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { UI_TIMEOUT } from '@utils/ui-flow';

/**
 * Waits for the application to finish its initial bootstrap/loading state.
 * It looks for the .cold-start-loader and waits for it to disappear.
 */
export async function waitForBootstrap(page: Page) {
  const loader = page.locator('.cold-start-loader');

  // We wait briefly to see if the loader appears (it might not if data is cached or fast)
  try {
    await loader.waitFor({ state: 'visible', timeout: 2000 });
    console.log('[Bootstrap] Cold start loader detected, waiting for it to finish...');
    await loader.waitFor({ state: 'hidden', timeout: UI_TIMEOUT });
    console.log('[Bootstrap] Cold start finished.');
  } catch (e) {
    // If it never appeared within 2s, we assume it's already done or skipped
    console.log('[Bootstrap] No loader detected or already finished.');
  }

  // Also wait for the root to not be empty
  await page.waitForSelector('#root:not(:empty)', { timeout: UI_TIMEOUT });
}

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

  // Wait for the application to be fully loaded (bootstrap completed)
  await waitForBootstrap(page);

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: UI_TIMEOUT });
}
