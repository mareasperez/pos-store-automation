import { expect, test } from '@playwright/test';
import { config } from '@config';

const frontendOrigin = new URL(config.baseUrl).origin;

const SHIFT_ID = 1001;

const buildOpenShift = () => ({
  id: SHIFT_ID,
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
  { id: 1, code: 'CASH', name: 'Efectivo', isCash: true, active: true, currency: 'NIO' },
];

test.describe('@manual @shifts', () => {
  test('UI closes an active shift from /shifts page calling /api/shifts/{id}/close', async ({
    page,
  }) => {
    let isShiftClosed = false;
    const shift = buildOpenShift();

    // Shifts list (ActiveShiftsTab uses GET /api/shifts?status=OPEN)
    await page.route(
      (url) => url.pathname.endsWith('/api/shifts') && url.search.includes('status'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: isShiftClosed ? JSON.stringify([]) : JSON.stringify([shift]),
        });
      }
    );

    // User list (ActiveShiftsTab renders username via useUsers)
    await page.route('**/api/users**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 1, username: 'admin', displayName: 'Admin' }]),
      });
    });

    // Payment methods (CloseShiftModal)
    await page.route('**/api/payment-methods**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(paymentMethodsFixture),
      });
    });

    // Shift detail with expected amounts (CloseShiftModal calls GET /shifts/{id}?includeExpectations=true)
    await page.route(
      (url) =>
        url.pathname === `/api/shifts/${shift.id}` ||
        url.pathname.startsWith(`/api/shifts/${shift.id}?`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(shift),
        });
      }
    );

    // Close mutation: POST /api/shifts/{id}/close (closeAnyUserShift hook)
    await page.route(
      (url) => url.pathname === `/api/shifts/${shift.id}/close`,
      async (route) => {
        isShiftClosed = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...shift, status: 'CLOSED', endedAt: new Date().toISOString() }),
        });
      }
    );

    // Register before navigation so the response cannot be missed.
    const closeResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/shifts/${shift.id}/close`,
      { timeout: 30_000 }
    );

    await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shifts/, { timeout: 20_000 });

    // Wait for the shift row with its close button to appear
    const closeBtn = page.getByTestId(`shift-close-btn-${shift.id}`);
    await expect(closeBtn).toBeVisible({ timeout: 20_000 });
    await closeBtn.click();

    const closeDialog = page.getByTestId('close-shift-modal');
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeVisible({ timeout: 15_000 });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

    await submitBtn.click();

    const closeResponse = await closeResponsePromise;
    expect(new URL(closeResponse.url()).origin).toBe(frontendOrigin);
    expect(closeResponse.status()).toBe(200);

    // After close, the row should disappear from the active shifts list.
    await expect(closeBtn).not.toBeVisible({ timeout: 15_000 });
  });
});

