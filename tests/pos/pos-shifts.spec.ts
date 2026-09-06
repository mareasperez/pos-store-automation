/**
 * POS shift smoke and open-shift tests.
 * These tests exercise shift state from the /pos screen, not from /shifts management.
 */
import { expect, test } from '@playwright/test';
import { config } from '@config';

const frontendOrigin = new URL(config.baseUrl).origin;
const apiOrigin = new URL(config.apiUrl).origin;
const acceptedApiOrigins = new Set([frontendOrigin, apiOrigin]);

const buildOpenShift = () => ({
  id: 1001,
  userId: 1,
  status: 'OPEN',
  startedAt: new Date().toISOString(),
  initialCash: 100,
  paymentReconciliations: [
    {
      id: 1,
      paymentMethodId: 1,
      paymentMethodName: 'Efectivo',
      expectedAmount: 0,
      countedAmount: 0,
      difference: 0,
    },
  ],
});

test.describe('@manual @pos shifts', () => {
  test('UI calls /api/shifts/active from POS screen', async ({ page }) => {
    const shiftResponsePromise = page.waitForResponse(
      (r) => r.request().method() === 'GET' && r.url().includes('/api/shifts/active')
    );

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

    const shiftResponse = await shiftResponsePromise;
    const responseUrl = new URL(shiftResponse.url());

    expect(acceptedApiOrigins).toContain(responseUrl.origin);
    expect(responseUrl.pathname).toBe('/api/shifts/active');

    if (shiftResponse.status() === 401) {
      test.skip(
        true,
        'Authenticated UI session is stale. Refresh state with npm run test:auth:setup.'
      );
    }

    expect([200, 204]).toContain(shiftResponse.status());
  });

  test('UI opens shift from POS and resolves /api/shifts/active as open', async ({ page }) => {
    // Skip if a real shift is already open — the mocked open call would conflict.
    const realShiftResp = await page.request.get('/api/shifts/active', {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    test.skip(
      realShiftResp.status() === 200,
      'An active shift already exists — close it first or run test:auth:setup.'
    );

    let isShiftOpen = false;

    await page.route('**/api/shifts/active**', async (route) => {
      const body = isShiftOpen ? JSON.stringify(buildOpenShift()) : null;
      await route.fulfill({
        status: isShiftOpen ? 200 : 204,
        contentType: 'application/json',
        body: body ?? undefined,
      });
    });

    await page.route('**/api/shifts/open', async (route) => {
      isShiftOpen = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildOpenShift()),
      });
    });

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

    const openButton = page.getByTestId('pos-open-shift').first();
    await expect(openButton).toBeVisible({ timeout: 20_000 });
    await openButton.click();

    await expect(page.getByTestId('shift-initial-cash-input')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('shift-initial-cash-input').fill('100');

    const openResponsePromise = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open')
    );
    await page.getByTestId('shift-open-submit').click();

    const openResponse = await openResponsePromise;
    expect(acceptedApiOrigins).toContain(new URL(openResponse.url()).origin);
    expect(new URL(openResponse.url()).pathname).toBe('/api/shifts/open');
    expect(openResponse.status()).toBe(200);

    const activeOpenResponse = await page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        r.url().includes('/api/shifts/active') &&
        r.status() === 200
    );
    expect(activeOpenResponse.status()).toBe(200);

    await expect(page.getByTestId('pos-close-shift')).toBeVisible({ timeout: 15_000 });
  });
});
