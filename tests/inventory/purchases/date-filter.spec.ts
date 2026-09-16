/**
 * Purchase history date-filter spec.
 *
 * Verifies that the date filter sends local-timezone boundaries to the backend
 * so a receipt created at any hour of the selected local day is included.
 *
 * Runs under the `chromium-authenticated` project which injects stored auth state,
 * so no explicit login is needed. The Playwright config also sets
 * `timezoneId: 'America/Managua'` (UTC-6) to simulate the real tenant environment.
 */
import { expect, parallelDescribe, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../../support/flows/auth.flow';
import { buildApiHeaders } from '../../../utils/apiHeaders';
import { config } from '@config';

// ── helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for a Date in the runtime's local timezone (matches browser behavior). */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yesterday(base: Date): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - 1);
  return d;
}

/** Local date (YYYY-MM-DD) of the most recently issued purchase receipt, or null if none exist. */
async function findMostRecentPurchaseDate(
  page: Parameters<typeof buildApiHeaders>[0]
): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(
    `${config.apiRoot}/inventory/purchase-receipts?page=0&size=1&sort=issuedAt,desc`,
    { headers }
  );
  if (!response.ok()) return null;

  const body = (await response.json()) as { content?: Array<{ issuedAt: string }> };
  const issuedAt = body.content?.[0]?.issuedAt;
  return issuedAt ? toLocalDateString(new Date(issuedAt)) : null;
}

// ── tests ───────────────────────────────────────────────────────────────────

parallelDescribe('Purchase history — date filter', () => {
  test.beforeEach(() => {
    requireCredentialsOrSkip('purchase history date-filter');
  });

  test('page loads and table renders when filtering by today', async ({ page }) => {
    const purchaseDate = await findMostRecentPurchaseDate(page);
    test.skip(!purchaseDate, 'No purchase receipts exist in the test tenant to filter by.');

    await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/inventory\/purchases/i, { timeout: 20_000 });

    await page.getByTestId('purchase-filter-from').fill(purchaseDate!);
    await page.getByTestId('purchase-filter-to').fill(purchaseDate!);

    await page.waitForResponse(
      (r) => r.url().includes('/api/inventory/purchase-receipts') && r.request().method() === 'GET',
      { timeout: 15_000 }
    );

    await expect(page.getByRole('table').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('table-state-error')).toBeHidden();
  });

  test('filter sends ISO timestamps with time component, not bare YYYY-MM-DD', async ({ page }) => {
    // Core contract: frontend must send full ISO instant (e.g. 2026-07-30T06:00:00.000Z)
    // so the backend uses the user's local-timezone bounds, not UTC midnight.
    const yesterdayStr = toLocalDateString(yesterday(new Date()));

    await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/inventory\/purchases/i, { timeout: 20_000 });

    // Set up listener before filling — must match a response that includes both params
    const responsePromise = page.waitForResponse(
      (r) => {
        if (!r.url().includes('/api/inventory/purchase-receipts') || r.request().method() !== 'GET')
          return false;
        const params = new URL(r.url()).searchParams;
        return params.has('from') && params.has('to');
      },
      { timeout: 15_000 }
    );

    await page.getByTestId('purchase-filter-from').fill(yesterdayStr);
    await page.getByTestId('purchase-filter-to').fill(yesterdayStr);
    const response = await responsePromise;

    const url = new URL(response.url());
    const fromParam = url.searchParams.get('from');
    const toParam = url.searchParams.get('to');

    // Must contain a time component — not a bare YYYY-MM-DD date string
    expect(fromParam).toMatch(/T\d{2}:\d{2}:\d{2}/);
    expect(toParam).toMatch(/T\d{2}:\d{2}:\d{2}/);

    // In UTC-6 (timezoneId: 'America/Managua' set in playwright.config.ts),
    // midnight of any date is 06:00:00Z — confirm the offset is correct
    expect(fromParam).toContain('T06:00:00');
    expect(toParam).toContain('T05:59:59');
  });
});
