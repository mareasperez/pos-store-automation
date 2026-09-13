import { type Page } from '@playwright/test';
import { config } from './config';

/**
 * Builds headers for direct `page.request.*` calls against the API.
 *
 * Cookies set for the frontend origin (localhost:5173, via the Vite proxy) are never
 * auto-attached to a cross-origin request to `config.apiRoot` (localhost:8081), so the
 * access_token must be forwarded manually as both `Authorization` and `Cookie`.
 *
 * `page.context().storageState()` can (rarely) race the context's own cookie application
 * right at test start — retry briefly instead of silently sending an unauthenticated request
 * that always 401s with no clear signal why.
 */
export async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
  let token: string | undefined;
  for (let attempt = 0; attempt < 3 && !token; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const storageState = await page.context().storageState();
    token = storageState.cookies.find((cookie) => cookie.name === 'access_token')?.value;
  }

  if (!token) {
    throw new Error(
      'buildApiHeaders: no access_token cookie found in the browser context after retries. ' +
        'Re-run "npm run test:auth:setup:local" to refresh the saved session.'
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    Cookie: `access_token=${token}`,
  };

  if (config.tenantId) {
    headers['X-Tenant-Id'] = config.tenantId;
  }

  return headers;
}
