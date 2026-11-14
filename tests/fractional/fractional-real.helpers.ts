import { expect } from '@fixtures';
import type { Page } from '@playwright/test';
import { config } from '@config';

const UI_ORIGIN = 'http://localhost:5173';
const API_ORIGIN = 'http://localhost:8081';
export const TEST_TENANT_ID = '651167cc-9f50-4ff1-a8d7-e9f8a68ccce5';

export async function assertLocalSavedSession(
  page: Page,
  requiredPermissions: readonly string[]
): Promise<() => void> {
  page.setDefaultTimeout(15_000);
  expect(config.environment).toBe('local');
  expect(config.baseUrl).toBe(UI_ORIGIN);
  expect(config.apiRoot).toBe(`${API_ORIGIN}/api`);
  expect(config.tenantId).toBe(TEST_TENANT_ID);

  const prohibitedAuthRequests: string[] = [];
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const loginOrRefresh = /(?:^|\/)(?:login|refresh)(?:\/|$)/i.test(url.pathname);
    const createsSession =
      request.method() === 'POST' && /(?:^|\/)sessions?(?:\/|$)/i.test(url.pathname);
    if (loginOrRefresh || createsSession) {
      prohibitedAuthRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }

    if (url.origin === UI_ORIGIN && url.pathname === '/config/app-config.json') {
      const response = await route.fetch();
      const runtimeConfig = (await response.json()) as { apiUrl: string };
      expect(['http://127.0.0.1:8081', API_ORIGIN]).toContain(new URL(runtimeConfig.apiUrl).origin);
      runtimeConfig.apiUrl = API_ORIGIN;
      await route.fulfill({ response, json: runtimeConfig });
      return;
    }

    const isLocalUi = url.origin === UI_ORIGIN;
    const isLocalApi =
      url.origin === API_ORIGIN && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
    if (isLocalUi || isLocalApi) {
      await route.continue();
      return;
    }

    await route.abort('blockedbyclient');
  });

  const savedState = await page.context().storageState();
  const storage = savedState.origins.find((origin) => origin.origin === UI_ORIGIN)?.localStorage;
  const app = JSON.parse(storage?.find((item) => item.name === 'pos_app_store')?.value ?? '{}') as {
    state?: {
      activeTenantId?: string;
      tenants?: { id: string; name: string }[];
      user?: { permissions?: string[] };
    };
  };
  expect(app.state?.activeTenantId).toBe(TEST_TENANT_ID);
  expect(app.state?.tenants).toContainEqual(
    expect.objectContaining({ id: TEST_TENANT_ID, name: 'test-tenant-2' })
  );
  expect(app.state?.user?.permissions ?? []).toEqual(
    expect.arrayContaining([...requiredPermissions])
  );

  const cart = JSON.parse(
    storage?.find((item) => item.name === 'pos_cart_storage')?.value ?? '{}'
  ) as { state?: { lines?: unknown[]; savedDrafts?: unknown[] } };
  expect(cart.state?.lines ?? [], 'Never alter a saved user cart').toHaveLength(0);
  expect(cart.state?.savedDrafts ?? [], 'Never alter saved user drafts').toHaveLength(0);

  return () => {
    expect(prohibitedAuthRequests, 'No login, refresh, or session creation').toEqual([]);
  };
}
