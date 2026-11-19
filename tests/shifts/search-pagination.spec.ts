import { expect, test } from '@fixtures';
import { config } from '@config';

const frontendOrigin = new URL(config.baseUrl).origin;
const apiOrigin = new URL(config.apiUrl).origin;
const acceptedApiOrigins = new Set([frontendOrigin, apiOrigin]);

const TARGET_SHIFT_ID = 1011;

type ShiftSummaryFixture = {
  id: number;
  userId: number;
  status: 'OPEN';
  startTime: string;
  initialCash: number;
};

const buildShift = (id: number): ShiftSummaryFixture => ({
  id,
  userId: 1,
  status: 'OPEN',
  startTime: `2026-06-${String((id % 27) + 1).padStart(2, '0')}T10:00:00Z`,
  initialCash: 100,
});

const buildPage = (content: ShiftSummaryFixture[], number: number) => ({
  content,
  number,
  size: 10,
  numberOfElements: content.length,
  totalElements: 11,
  totalPages: 2,
  first: number === 0,
  last: number === 1,
  empty: content.length === 0,
  sort: ['startTime,DESC', 'id,ASC'],
});

test('@manual @shifts preserves combined filters across shift tabs and pages', async ({ page }) => {
  const searchRequests: string[] = [];

  await page.route('**/api/shifts/active', async (route) => {
    await route.fulfill({ status: 204 });
  });

  await page.route('**/api/users**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 1, username: 'cashier', displayName: 'Cashier' }]),
    });
  });

  await page.route(
    (url) => url.pathname.endsWith('/api/shifts/search'),
    async (route) => {
      const requestUrl = new URL(route.request().url());
      searchRequests.push(requestUrl.toString());
      const requestedPage = Number(requestUrl.searchParams.get('page') ?? 0);
      const content =
        requestedPage === 0
          ? Array.from({ length: 10 }, (_, index) => buildShift(1001 + index))
          : [buildShift(TARGET_SHIFT_ID)];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildPage(content, requestedPage)),
      });
    }
  );

  await page.route(
    (url) =>
      url.pathname === `/api/shifts/${TARGET_SHIFT_ID}` &&
      url.searchParams.has('includeSalesPayments'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildShift(TARGET_SHIFT_ID),
          cashMovements: [],
          salesPayments: [],
          paymentReconciliations: [],
        }),
      });
    }
  );

  await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('shift-row-1001')).toBeVisible();
  await expect(page.getByText('Page 1 / 2')).toBeVisible();

  const filteredResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      requestUrl.pathname.endsWith('/api/shifts/search') &&
      requestUrl.searchParams.get('status') === 'OPEN' &&
      requestUrl.searchParams.get('userId') === '1' &&
      requestUrl.searchParams.get('page') === '0'
    );
  });
  await page.getByRole('combobox', { name: /Opened by|Usuario que abrió/ }).click();
  await page.getByRole('option', { name: 'Cashier' }).click();
  const filteredPage = await filteredResponse;
  expect(filteredPage.status()).toBe(200);
  expect(new URL(filteredPage.url()).searchParams.get('userId')).toBe('1');

  const dates = await page.evaluate(() => {
    const first = new Date();
    first.setDate(10);
    const last = new Date(first);
    last.setDate(15);
    const isoDate = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
      firstLabel: first.toLocaleDateString(),
      lastLabel: last.toLocaleDateString(),
      fromDate: isoDate(first),
      toDate: isoDate(last),
    };
  });
  await page.getByRole('button', { name: /Period|Periodo/ }).click();
  await page.locator(`[data-day="${dates.firstLabel}"]`).click();
  const dateResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return (
      requestUrl.pathname.endsWith('/api/shifts/search') &&
      requestUrl.searchParams.get('fromDate') === dates.fromDate &&
      requestUrl.searchParams.get('toDate') === dates.toDate
    );
  });
  await page.locator(`[data-day="${dates.lastLabel}"]`).click();
  expect((await dateResponse).status()).toBe(200);
  await page.getByRole('button', { name: /Period|Periodo/ }).click();

  const nextPageResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      requestUrl.pathname.endsWith('/api/shifts/search') &&
      requestUrl.searchParams.get('userId') === '1' &&
      requestUrl.searchParams.get('page') === '1'
    );
  });
  await page.getByTestId('pagination-next').click();

  const response = await nextPageResponse;
  const pageTwoUrl = new URL(response.url());
  expect(acceptedApiOrigins).toContain(pageTwoUrl.origin);
  expect(response.status()).toBe(200);
  expect(pageTwoUrl.searchParams.get('status')).toBe('OPEN');
  expect(pageTwoUrl.searchParams.get('userId')).toBe('1');
  expect(pageTwoUrl.searchParams.get('fromDate')).toBe(dates.fromDate);
  expect(pageTwoUrl.searchParams.get('toDate')).toBe(dates.toDate);
  expect(pageTwoUrl.searchParams.get('page')).toBe('1');
  expect(pageTwoUrl.searchParams.get('size')).toBe('10');
  await expect(page.getByTestId(`shift-row-${TARGET_SHIFT_ID}`)).toBeVisible();
  await expect(page.getByTestId('shift-row-1001')).toHaveCount(0);
  await expect(page.getByText('Page 2 / 2')).toBeVisible();

  await page.getByTestId(`shift-row-${TARGET_SHIFT_ID}`).click();
  await expect(page.getByTestId('shift-details-dialog')).toBeVisible();

  const allShiftsResponse = page.waitForResponse((allResponse) => {
    const requestUrl = new URL(allResponse.url());
    return (
      allResponse.request().method() === 'GET' &&
      requestUrl.pathname.endsWith('/api/shifts/search') &&
      requestUrl.searchParams.get('userId') === '1' &&
      requestUrl.searchParams.get('page') === '0'
    );
  });
  await page.getByRole('button', { name: /All shifts|Todos los turnos/ }).click();
  const allShifts = await allShiftsResponse;
  const allShiftsUrl = new URL(allShifts.url());
  expect(allShifts.status()).toBe(200);
  expect(allShiftsUrl.searchParams.get('userId')).toBe('1');
  expect(allShiftsUrl.searchParams.get('fromDate')).toBe(dates.fromDate);
  expect(allShiftsUrl.searchParams.get('toDate')).toBe(dates.toDate);
  expect(allShiftsUrl.searchParams.has('status')).toBe(false);
  expect(searchRequests.length).toBeGreaterThanOrEqual(4);
});
