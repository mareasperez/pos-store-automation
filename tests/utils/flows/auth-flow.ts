import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { UI_TIMEOUT } from '@utils/ui-flow';

type TenantSnapshot = {
  activeTenantId: string | null;
  tenantIds: string[];
};

async function readTenantSnapshot(page: Page): Promise<TenantSnapshot> {
  return page.evaluate(() => {
    const empty: TenantSnapshot = { activeTenantId: null, tenantIds: [] };
    const raw = window.localStorage.getItem('pos_app_store');
    if (!raw) return empty;

    try {
      const parsed = JSON.parse(raw);
      const state = parsed?.state ?? {};
      const activeTenantId = typeof state.activeTenantId === 'string' ? state.activeTenantId : null;
      const tenantIds = Array.isArray(state.tenants)
        ? state.tenants
            .map((tenant: { id?: unknown }) => (typeof tenant?.id === 'string' ? tenant.id : null))
            .filter((id: string | null): id is string => id != null)
        : [];

      return { activeTenantId, tenantIds };
    } catch {
      return empty;
    }
  });
}

async function ensureConfiguredTenantOrFail(page: Page): Promise<void> {
  if (!config.tenantId) return;

  const requestedTenantId = config.tenantId;
  const snapshot = await readTenantSnapshot(page);

  if (!snapshot.tenantIds.includes(requestedTenantId)) {
    const available = snapshot.tenantIds.join(', ') || '(none)';
    throw new Error(
      `TEST_TENANT_ID='${requestedTenantId}' is not assigned to this user. Available tenant IDs: ${available}`
    );
  }

  if (snapshot.activeTenantId !== requestedTenantId) {
    const tenantSelector = page.getByLabel('Select Tenant');
    const selectorVisible = await tenantSelector.isVisible().catch(() => false);

    if (selectorVisible) {
      await tenantSelector.selectOption(requestedTenantId);
    }

    const updatedSnapshot = await readTenantSnapshot(page);
    if (updatedSnapshot.activeTenantId !== requestedTenantId) {
      throw new Error(
        `Could not activate TEST_TENANT_ID='${requestedTenantId}'. Active tenant after login is '${updatedSnapshot.activeTenantId ?? '(none)'}'.`
      );
    }
  }
}

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
  const requestedTenantId = config.tenantId;

  // Capture browser console logs for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`PAGE ERROR: ${msg.text()}`);
  });

  // Ensure Spanish is set before any JS loads
  await page.addInitScript(({ tenantId }: { tenantId: string | null }) => {
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
    if (tenantId) {
      try {
        const appStorage = window.localStorage.getItem('pos_app_store');
        const parsed = appStorage ? JSON.parse(appStorage) : { state: {}, version: 0 };
        parsed.state = {
          ...(parsed.state ?? {}),
          activeTenantId: tenantId,
        };
        window.localStorage.setItem('pos_app_store', JSON.stringify(parsed));
      } catch (e) {
        // ignore
      }
    }
  }, { tenantId: requestedTenantId });

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
  const loginError = page.locator('#login-error');
  let didNavigate = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.fill('input[name="username"]', config.credentials.username);
    await page.fill('input[name="password"]', config.credentials.password);
    await page.click('button[type="submit"]');

    const loginResult = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.includes('/login'), {
          timeout: UI_TIMEOUT,
          waitUntil: 'domcontentloaded',
        })
        .then(() => 'navigated' as const)
        .catch(() => 'timeout' as const),
      loginError
        .waitFor({ state: 'visible', timeout: UI_TIMEOUT })
        .then(() => 'error' as const)
        .catch(() => 'timeout' as const),
    ]);

    if (loginResult === 'navigated') {
      didNavigate = true;
      break;
    }

    if (loginResult === 'error') {
      const errorText = (await loginError.textContent().catch(() => null))?.trim() || 'no detail';
      console.log(`Login failed. Current URL: ${page.url()}`);
      throw new Error(
        `Login did not complete. Check TEST_USERNAME/TEST_PASSWORD in automation/.env or root .env. UI error: ${errorText}`
      );
    }

    if (attempt < 2) {
      console.log('[Login] Timeout waiting for navigation. Retrying login once...');
      await page.goto('/login?lng=es');
    }
  }

  if (!didNavigate) {
    throw new Error(
      'Login did not complete after retry. The login request may be hanging in the environment. Verify backend health and retry.'
    );
  }

  // Wait for the application to be fully loaded (bootstrap completed)
  await waitForBootstrap(page);
  await ensureConfiguredTenantOrFail(page);

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: UI_TIMEOUT });
}
