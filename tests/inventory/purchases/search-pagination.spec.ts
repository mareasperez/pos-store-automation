/**
 * Purchase history — search and pagination spec.
 *
 * Verifies that the text search, supplier filter, and pagination controls
 * trigger the correct server-side query parameters on /api/inventory/purchase-receipts.
 *
 * Runs under the `chromium-authenticated` project (stored auth state injected).
 */
import { expect, test } from '@playwright/test';
import { requireCredentialsOrSkip } from '../../../support/flows/auth.flow';

const PURCHASES_URL = /\/api\/inventory\/purchase-receipts/;
const SEARCH_DEBOUNCE_MS = 600; // 500 ms debounce + small buffer

// ── helpers ─────────────────────────────────────────────────────────────────

function urlParams(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

async function gotoAndAwaitInitialLoad(page: Parameters<typeof test>[1]['page']) {
  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });
  // Wait for the first automatic data fetch to complete.
  await page.waitForResponse(
    (r) => PURCHASES_URL.test(r.url()) && r.request().method() === 'GET',
    { timeout: 15_000 }
  );
}

// ── tests ────────────────────────────────────────────────────────────────────

test.describe('Purchase history — search', () => {
  test.beforeEach(() => {
    requireCredentialsOrSkip('purchase history search and pagination');
  });

  test('@regression @purchases @manual text search sends search query param', async ({ page }) => {
    await gotoAndAwaitInitialLoad(page);

    const searchTerm = 'test';

    const searchResponse = page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        urlParams(r.url()).get('search') === searchTerm,
      { timeout: 15_000 }
    );

    await page.getByTestId('purchase-search').fill(searchTerm);
    // Wait for debounce
    await page.waitForTimeout(SEARCH_DEBOUNCE_MS);

    await searchResponse;
  });

  // Note: clearing back to the initial state is served from TanStack Query cache
  // (same query key), so no new network request is issued. The positive-path test
  // above is sufficient to verify the search param contract.
});

test.describe('Purchase history — supplier filter', () => {
  test.beforeEach(() => {
    requireCredentialsOrSkip('purchase history search and pagination');
  });

  test('@regression @purchases @manual supplier filter sends supplierId query param', async ({
    page,
  }) => {
    await gotoAndAwaitInitialLoad(page);

    const supplierSelect = page.getByTestId('purchase-supplier-filter');
    const options = await supplierSelect.locator('option').all();

    // index 0 is the placeholder "All suppliers"
    const hasRealOptions = options.length > 1;
    if (!hasRealOptions) {
      console.warn('[E2E][SKIP] No supplier options available — skipping supplier filter test');
      test.skip(!hasRealOptions, 'No supplier options available in this environment');
    }

    const firstOption = options[1];
    const supplierId = await firstOption.getAttribute('value');

    const filterResponse = page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        urlParams(r.url()).get('supplierId') === supplierId,
      { timeout: 15_000 }
    );

    await supplierSelect.selectOption({ index: 1 });

    await filterResponse;
  });

  // Note: clearing back to the initial state is served from TanStack Query cache,
  // so no new network request is issued. The positive-path test above is sufficient.
});

test.describe('Purchase history — pagination', () => {
  test.beforeEach(() => {
    requireCredentialsOrSkip('purchase history search and pagination');
  });

  test('@regression @purchases @manual next page button sends page=1 param', async ({ page }) => {
    await gotoAndAwaitInitialLoad(page);

    const nextButton = page.getByRole('button', { name: /next|siguiente/i });
    const isEnabled = await nextButton.isEnabled();
    test.skip(!isEnabled, 'Only one page of results — next page not applicable');

    const nextPageResponse = page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        urlParams(r.url()).get('page') === '1',
      { timeout: 15_000 }
    );

    await nextButton.click();

    await nextPageResponse;
    await expect(page.getByText(/page 2|página 2/i)).toBeVisible({ timeout: 10_000 });
  });

  test('@regression @purchases @manual prev button returns to page 1', async ({ page }) => {
    await gotoAndAwaitInitialLoad(page);

    const nextButton = page.getByRole('button', { name: /next|siguiente/i });
    const isEnabled = await nextButton.isEnabled();
    test.skip(!isEnabled, 'Only one page of results — pagination not applicable');

    await nextButton.click();
    await page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        urlParams(r.url()).get('page') === '1',
      { timeout: 15_000 }
    );

    const prevResponse = page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        (urlParams(r.url()).get('page') === '0' || !urlParams(r.url()).has('page')),
      { timeout: 15_000 }
    );

    await page.getByRole('button', { name: /prev|anterior/i }).click();

    await prevResponse;
    await expect(page.getByText(/page 1|página 1/i)).toBeVisible({ timeout: 10_000 });
  });

  test('@regression @purchases @manual page size change sends correct size param', async ({
    page,
  }) => {
    await gotoAndAwaitInitialLoad(page);

    const sizeResponse = page.waitForResponse(
      (r) =>
        PURCHASES_URL.test(r.url()) &&
        r.request().method() === 'GET' &&
        urlParams(r.url()).get('size') === '50',
      { timeout: 15_000 }
    );

    // The Select component renders the <select> inside a wrapper div with class
    // 'pagination__select'. Target the inner form-select__control element.
    await page.locator('.pagination__select .form-select__control').selectOption('50');

    await sizeResponse;
  });
});
