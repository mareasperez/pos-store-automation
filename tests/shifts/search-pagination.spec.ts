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

test('@manual @shifts paginates shift summaries through the typed search route', async ({
  page,
}) => {
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

  const nextPageResponse = page.waitForResponse((response) => {
    const requestUrl = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      requestUrl.pathname.endsWith('/api/shifts/search') &&
      requestUrl.searchParams.get('page') === '1'
    );
  });
  await page.getByTestId('pagination-next').click();

  const response = await nextPageResponse;
  const pageTwoUrl = new URL(response.url());
  expect(acceptedApiOrigins).toContain(pageTwoUrl.origin);
  expect(response.status()).toBe(200);
  expect(pageTwoUrl.searchParams.get('status')).toBe('OPEN');
  expect(pageTwoUrl.searchParams.get('page')).toBe('1');
  expect(pageTwoUrl.searchParams.get('size')).toBe('10');
  await expect(page.getByTestId(`shift-row-${TARGET_SHIFT_ID}`)).toBeVisible();
  await expect(page.getByTestId('shift-row-1001')).toHaveCount(0);
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  expect(searchRequests).toHaveLength(2);

  await page.getByTestId(`shift-row-${TARGET_SHIFT_ID}`).click();
  await expect(page.getByTestId('shift-details-dialog')).toBeVisible();
});
