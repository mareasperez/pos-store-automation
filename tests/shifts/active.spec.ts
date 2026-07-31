import { expect, test } from '@playwright/test';
import { config } from '@config';

const frontendOrigin = new URL(config.baseUrl).origin;

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

const paymentMethodsFixture = [
  {
    id: 1,
    code: 'CASH',
    name: 'Efectivo',
    isCash: true,
    active: true,
    currency: 'NIO',
  },
];

test.describe('@manual @pos shifts', () => {
  test('UI calls /api/shifts/active from POS screen', async ({ page }) => {
    const shiftResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/shifts/active')
    );

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

    const shiftResponse = await shiftResponsePromise;
    const responseUrl = new URL(shiftResponse.url());

    expect(responseUrl.origin).toBe(frontendOrigin);
    expect(responseUrl.pathname).toBe('/api/shifts/active');

    if (shiftResponse.status() === 401) {
      test.skip(true, 'Authenticated UI session is stale. Refresh state with npm run test:auth:setup.');
    }

    expect([200, 204]).toContain(shiftResponse.status());
  });

  test('UI opens shift and then resolves /api/shifts/active as open', async ({ page }) => {
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

    const openButton = page.getByRole('button', { name: /Abrir Caja|Open Shift/i }).first();
    await expect(openButton).toBeVisible();
    await openButton.click();

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('100');

    const openResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/shifts/open')
    );

    await page.getByRole('button', { name: /Abrir Caja/i }).last().click();

    const openResponse = await openResponsePromise;
    const openResponseUrl = new URL(openResponse.url());

    expect(openResponseUrl.origin).toBe(frontendOrigin);
    expect(openResponseUrl.pathname).toBe('/api/shifts/open');
    expect(openResponse.status()).toBe(200);

    const activeOpenResponse = await page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/shifts/active') &&
        response.status() === 200
    );

    expect(activeOpenResponse.status()).toBe(200);
    await expect(page.getByRole('button', { name: /Cerrar Caja|Close Shift/i })).toBeVisible();
  });

  test('UI closes current open shift calling /api/shifts/close', async ({ page }) => {
    let isShiftOpen = true;

    await page.route('**/api/shifts/active**', async (route) => {
      const body = isShiftOpen ? JSON.stringify(buildOpenShift()) : null;
      await route.fulfill({
        status: isShiftOpen ? 200 : 204,
        contentType: 'application/json',
        body: body ?? undefined,
      });
    });

    await page.route('**/api/payment-methods**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(paymentMethodsFixture),
      });
    });

    await page.route('**/shifts/close', async (route) => {
      isShiftOpen = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildOpenShift(),
          status: 'CLOSED',
          endedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

    const closeTrigger = page.getByRole('button', { name: /Cerrar Caja|Close Shift/i }).first();
    await expect(closeTrigger).toBeVisible();
    await closeTrigger.click();

    const closeDialog = page.getByRole('dialog');
    await expect(closeDialog).toBeVisible();

    const closeResponsePromise = page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'POST') return false;
        const responseUrl = new URL(response.url());
        return responseUrl.pathname.includes('/shifts/close');
      }
    );

    await closeDialog.getByRole('button', { name: /^Cerrar Caja$/i }).click();

    const closeResponse = await closeResponsePromise;
    const closeResponseUrl = new URL(closeResponse.url());

    expect(closeResponseUrl.origin).toBe(frontendOrigin);
    expect(closeResponseUrl.pathname.endsWith('/shifts/close')).toBe(true);
    expect(closeResponse.status()).toBe(200);

    const activeClosedResponse = await page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/shifts/active') &&
        response.status() === 204
    );

    expect(activeClosedResponse.status()).not.toBe(404);
    expect(activeClosedResponse.status()).toBe(204);
    await expect(page.getByRole('button', { name: /Abrir Caja|Open Shift/i })).toBeVisible();
  });
});
