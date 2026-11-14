import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { config } from '@config';
import { assertConfiguredTarget } from '../../support/flows/target.flow';
import { comboPreflight } from '../../support/flows/combos.flow';

const tenantId = config.tenantId;
const frontendOrigin = new URL(config.baseUrl).origin;
const apiRoot = new URL(config.apiRoot);
const apiPrefix = apiRoot.pathname.replace(/\/+$/, '') || '/';
const staleRuntimeApiUrl = 'http://127.0.0.1:8081/api';

test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: frontendOrigin,
        localStorage: [
          {
            name: 'pos_app_store',
            value: JSON.stringify({
              state: {
                activeTenantId: tenantId,
                tenants: [{ id: tenantId }],
                user: { permissions: [] },
              },
            }),
          },
          {
            name: 'pos_cart_storage',
            value: JSON.stringify({
              state: {
                lines: [],
                savedDrafts: [],
                manualDiscountAmountInput: '',
                manualDiscountReason: '',
              },
            }),
          },
        ],
      },
    ],
  },
});
test.setTimeout(15_000);

function apiUrl(path: string, origin = apiRoot.origin): string {
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

async function installOfflineApp(
  page: Page,
  effectiveApiUrl?: string,
  effectiveApiMethod = 'GET',
  telemetryUrl?: string
): Promise<{
  genericConfigRequests: string[];
  effectiveApiRequests: string[];
}> {
  const genericConfigRequests: string[] = [];
  const effectiveApiRequests: string[] = [];
  const corsHeaders = {
    'Access-Control-Allow-Origin': frontendOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'x-tenant-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.isNavigationRequest() && url.origin === frontendOrigin) {
      const staleConfigRequest = `fetch('/config/app-config.json').catch(() => undefined)`;
      const effectiveApiRequest = effectiveApiUrl
        ? `fetch(${JSON.stringify(effectiveApiUrl)}, {
            method: ${JSON.stringify(effectiveApiMethod)},
            headers: { 'X-Tenant-Id': ${JSON.stringify(tenantId)} }
          }).catch(() => undefined)`
        : 'Promise.resolve(undefined)';
      const telemetryRequest = telemetryUrl
        ? `fetch(${JSON.stringify(telemetryUrl)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body: 'offline telemetry envelope'
          }).catch(() => undefined)`
        : 'Promise.resolve(undefined)';
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<html><body><script>
          Promise.all([${staleConfigRequest}, ${effectiveApiRequest}, ${telemetryRequest}]);
        </script></body></html>`,
      });
      return;
    }

    if (url.pathname === '/config/app-config.json' && request.method() === 'GET') {
      genericConfigRequests.push(`${url.origin}${url.pathname}`);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { apiUrl: staleRuntimeApiUrl },
      });
      return;
    }

    const expectedPath =
      apiPrefix === '/' ? url.pathname.startsWith('/') : url.pathname.startsWith(`${apiPrefix}/`);
    if (url.origin === apiRoot.origin && expectedPath) {
      effectiveApiRequests.push(`${url.origin}${url.pathname}`);
      await route.fulfill({
        status: request.method() === 'OPTIONS' ? 204 : 200,
        headers: corsHeaders,
        ...(request.method() === 'OPTIONS'
          ? {}
          : { contentType: 'application/json', json: { status: 'OPEN' } }),
      });
      return;
    }

    await route.abort('blockedbyclient');
  });

  return { genericConfigRequests, effectiveApiRequests };
}

test('preflight validates the effective API traffic without trusting stale generic config JSON', async ({
  page,
}) => {
  const mock = await installOfflineApp(page, apiUrl(`${apiPrefix}/shifts/active`));

  const assertNoAuthRequests = await assertConfiguredTarget(page);

  assertNoAuthRequests();
  await expect
    .poll(() => mock.effectiveApiRequests.some((request) => request.includes('/shifts/active')))
    .toBe(true);
  expect(mock.genericConfigRequests).toHaveLength(1);
});

test('preflight ignores Sentry envelopes and still validates the configured app API', async ({
  page,
}) => {
  const telemetryUrl = 'https://o1.ingest.us.sentry.io/api/1/envelope/';
  const failedTelemetryRequests: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url() === telemetryUrl) failedTelemetryRequests.push(request.url());
  });
  const mock = await installOfflineApp(
    page,
    apiUrl(`${apiPrefix}/shifts/active`),
    'GET',
    telemetryUrl
  );

  const assertNoAuthRequests = await assertConfiguredTarget(page);

  assertNoAuthRequests();
  await expect
    .poll(() => mock.effectiveApiRequests.some((request) => request.includes('/shifts/active')))
    .toBe(true);
  await expect.poll(() => failedTelemetryRequests).toContain(telemetryUrl);
});

test('preflight does not accept telemetry alone as proof of the configured API', async ({
  page,
}) => {
  await installOfflineApp(page, undefined, 'GET', 'https://o1.ingest.us.sentry.io/api/1/envelope/');

  await expect(assertConfiguredTarget(page)).rejects.toThrow(/no effective browser API request/i);
});

test('preflight ignores frontend metadata while validating the application API', async ({
  page,
}) => {
  await installOfflineApp(page, apiUrl(`${apiPrefix}/shifts/active`));
  await page
    .context()
    .route('**/deployment-info.json', (route) => route.fulfill({ json: { version: 'offline' } }));
  await page.addInitScript(() => {
    void fetch('/deployment-info.json').catch(() => undefined);
  });

  const assertNoAuthRequests = await assertConfiguredTarget(page);

  expect(assertNoAuthRequests).not.toThrow();
});

test('preflight rejects a browser API request to another origin before fixture work', async ({
  page,
}) => {
  const unexpectedApiUrl = apiUrl(`${apiPrefix}/shifts/active`, 'https://wrong-api.invalid');
  await installOfflineApp(page, unexpectedApiUrl);
  let fixtureStarted = false;

  let preflightError: unknown;
  try {
    await assertConfiguredTarget(page);
    fixtureStarted = true;
  } catch (error) {
    preflightError = error;
  }
  expect(preflightError).toBeInstanceOf(Error);
  expect((preflightError as Error).message).toMatch(/effective browser API target mismatch/i);
  expect(fixtureStarted).toBe(false);
});

test('preflight rejects a saved session from another tenant before fixture work', async ({
  page,
}) => {
  await installOfflineApp(page, apiUrl(`${apiPrefix}/shifts/active`));
  await page.goto(config.baseUrl);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pos_app_store') ?? '{}') as {
      state: { activeTenantId: string };
    };
    saved.state.activeTenantId = 'another-tenant';
    localStorage.setItem('pos_app_store', JSON.stringify(saved));
  });
  await expect(assertConfiguredTarget(page)).rejects.toThrow(/saved active tenant/i);
});

test('combo preflight accepts the configured target and validates the real actor and shift contract', async ({
  page,
}) => {
  const permissions = [
    'products:view',
    'products:create',
    'products:edit',
    'customers:view',
    'customers:create',
    'inventory:view',
    'warehouses:view',
    'sales:create',
    'sales:view',
    'sales:void',
    'returns:create',
    'quotes:create',
    'quotes:view',
  ];
  await installOfflineApp(page, apiUrl(`${apiPrefix}/shifts/active`));
  await page.goto(config.baseUrl);
  await page.evaluate((requiredPermissions) => {
    const saved = JSON.parse(localStorage.getItem('pos_app_store') ?? '{}') as {
      state: { user: { id: number; username: string; permissions: string[] } };
    };
    saved.state.user = { id: 8, username: 'cashier', permissions: requiredPermissions };
    localStorage.setItem('pos_app_store', JSON.stringify(saved));
  }, permissions);
  await page
    .context()
    .addCookies([{ name: 'access_token', value: 'offline-token', url: config.baseUrl }]);
  const paths: string[] = [];
  Object.defineProperty(page.request, 'fetch', {
    value: async (url: string, options: { method: string }) => {
      expect(options.method).toBe('GET');
      const path = new URL(url).pathname;
      paths.push(path);
      const json =
        path === `${apiPrefix}/me`
          ? { username: 'cashier', permissions }
          : path === `${apiPrefix}/shifts/active`
            ? { id: 12, userId: 8, status: 'OPEN' }
            : null;
      expect(json, `Unexpected mock API request: ${path}`).not.toBeNull();
      return {
        ok: () => true,
        status: () => 200,
        text: async () => '',
        json: async () => json,
      } as APIResponse;
    },
  });
  const assertRequests = await comboPreflight(page);
  assertRequests();
  expect(paths).toEqual([`${apiPrefix}/me`, `${apiPrefix}/shifts/active`]);
});

test('preflight rejects an incorrect API prefix on the configured origin', async ({ page }) => {
  const wrongPath = apiUrl('/other/shifts/active');
  await installOfflineApp(page, wrongPath);

  await expect(assertConfiguredTarget(page)).rejects.toThrow(
    /effective browser API target mismatch/i
  );
});

test('preflight rejects authentication mutations during the read-only browser probe', async ({
  page,
}) => {
  const authUrl = apiUrl(`${apiPrefix}/auth/refresh`);
  await installOfflineApp(page, authUrl, 'POST');

  await expect(assertConfiguredTarget(page)).rejects.toThrow(/blocked .* refresh/i);
});

test('preflight blocks application mutations during the read-only browser probe', async ({
  page,
}) => {
  await installOfflineApp(page, apiUrl(`${apiPrefix}/sales`), 'POST');

  await expect(assertConfiguredTarget(page)).rejects.toThrow(/blocked mutation/i);
});

test('preflight fails within its bound when the browser makes no API request', async ({ page }) => {
  await installOfflineApp(page);

  await expect(assertConfiguredTarget(page)).rejects.toThrow(/no effective browser API request/i);
});

test('session-only preflight does not navigate for API-only specs', async ({ page }) => {
  await assertConfiguredTarget(page, { verifyBrowserTarget: false });

  expect(page.url()).toBe('about:blank');
});
