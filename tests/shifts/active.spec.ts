import { expect, parallelDescribe, test } from '@fixtures';
import { config } from '@config';

const frontendOrigin = new URL(config.baseUrl).origin;
const apiOrigin = new URL(config.apiUrl).origin;
const acceptedApiOrigins = new Set([frontendOrigin, apiOrigin]);

const SHIFT_ID = 1001;

type ShiftSummaryFixture = {
  id: number;
  userId: number;
  status: 'OPEN' | 'CLOSED';
  startTime: string;
  endTime?: string;
  initialCash: number;
  finalCash?: number;
  expectedCash?: number;
  cashDifference?: number;
};

type ShiftFixture = ShiftSummaryFixture & {
  paymentReconciliations: {
    id: number;
    paymentMethodId: number;
    paymentMethodName: string;
    expectedAmount: number;
    countedAmount: number;
    difference: number;
  }[];
};

const buildOpenShift = (): ShiftFixture => ({
  id: SHIFT_ID,
  userId: 1,
  status: 'OPEN',
  startTime: new Date().toISOString(),
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

const buildShiftPage = (
  content: ShiftSummaryFixture[],
  number: number,
  totalElements: number,
  totalPages: number
) => ({
  content,
  number,
  size: 10,
  numberOfElements: content.length,
  totalElements,
  totalPages,
  first: number === 0,
  last: totalPages === 0 || number === totalPages - 1,
  empty: content.length === 0,
  sort: ['startTime,DESC', 'id,ASC'],
});

const paymentMethodsFixture = [
  { id: 1, code: 'CASH', name: 'Efectivo', isCash: true, active: true, currency: 'NIO' },
];

test('@manual @shifts keeps all three tabs above a full-width open action on mobile', async ({
  page,
}) => {
  await page.route('**/api/shifts/active', (route) => route.fulfill({ status: 204 }));

  for (const [locale, ...labels] of [
    ['es', 'Todos los turnos', 'Turnos Activos', 'Turnos cerrados', 'Abrir Caja'],
    ['en', 'All shifts', 'Active Shifts', 'Closed shifts', 'Open Shift'],
  ]) {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/shifts?lng=${locale}`, { waitUntil: 'domcontentloaded' });

    const tabList = page.getByRole('tablist');
    const tabs = labels
      .slice(0, 3)
      .map((name) => tabList.getByRole('button', { name, exact: true }));
    const open = page.getByTestId('shift-open-button');
    await expect(tabList.getByRole('button')).toHaveCount(3);
    await expect(open).toHaveAccessibleName(labels[3]);
    await expect(open).toBeEnabled();

    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });

      for (const control of [...tabs, open]) {
        await expect(control).toBeInViewport({ ratio: 1 });
        const labelFits = await control.evaluate((button) => {
          const label = document.createRange();
          label.selectNodeContents(button);
          const bounds = button.getBoundingClientRect();
          const lines = Array.from(label.getClientRects());
          return (
            lines.length > 0 &&
            lines.every(
              (line) =>
                line.left >= bounds.left &&
                line.right <= bounds.right &&
                line.top >= bounds.top &&
                line.bottom <= bounds.bottom
            )
          );
        });
        expect(labelFits).toBe(true);
      }

      const [first, second, third, action] = await Promise.all(
        [...tabs, open].map((control) =>
          control.evaluate((button) => button.getBoundingClientRect().toJSON() as DOMRect)
        )
      );
      expect(second.y).toBeCloseTo(first.y);
      expect(third.y).toBeCloseTo(first.y);
      expect(second.left).toBeGreaterThan(first.right);
      expect(third.left).toBeGreaterThan(second.right);

      if (width <= 768) {
        expect(second.width).toBeCloseTo(first.width, 1);
        expect(third.width).toBeCloseTo(first.width, 1);
        expect(action.top).toBeGreaterThan(Math.max(first.bottom, second.bottom, third.bottom));
        expect(action.left).toBeCloseTo(first.left);
        expect(action.right).toBeCloseTo(third.right);
      } else {
        expect(action.left).toBeGreaterThan(third.right);
        expect(action.top + action.height / 2).toBeCloseTo(first.top + first.height / 2);
      }
    }

    await page.setViewportSize({ width: 320, height: 800 });
    await tabs[0].focus();
    for (const control of [...tabs.slice(1), open]) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
    }
  }
});

parallelDescribe('@manual @shifts', () => {
  test('UI closes an active shift from /shifts page calling /api/shifts/{id}/close', async ({
    page,
  }) => {
    let isShiftClosed = false;
    const shift = buildOpenShift();

    // Typed shift search (ActiveShiftsTab uses GET /api/shifts/search).
    await page.route(
      (url) => url.pathname.endsWith('/api/shifts/search'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            isShiftClosed ? buildShiftPage([], 0, 0, 0) : buildShiftPage([shift], 0, 1, 1)
          ),
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

    // The close action lives inside the row actions dropdown, which mounts only once opened.
    const actionsBtn = page.getByTestId(`shift-actions-${shift.id}`);
    await expect(actionsBtn).toBeVisible({ timeout: 20_000 });
    await actionsBtn.click();

    const closeBtn = page.getByTestId(`shift-close-btn-${shift.id}`);
    await closeBtn.waitFor({ state: 'attached', timeout: 5_000 }); // Dropdown mounts after click
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await closeBtn.click();

    const closeDialog = page.getByTestId('close-shift-modal');
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeVisible({ timeout: 15_000 });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

    await submitBtn.click();

    const closeResponse = await closeResponsePromise;
    expect(acceptedApiOrigins).toContain(new URL(closeResponse.url()).origin);
    expect(closeResponse.status()).toBe(200);

    // After close, the row should disappear from the active shifts list.
    await expect(actionsBtn).not.toBeVisible({ timeout: 15_000 });
  });
});
