/**
 * Dedicated cross-module e2e worker: open shift -> N real cash sales -> verify the server's own
 * expected-cash reconciliation matches what we actually sold -> close shift.
 *
 * Tag: @real @manual @shifts @shift-destructive @shift-reconciliation — pinned to cashier 1
 * (user-0.json). @shift-destructive tests are excluded from the default suite (see
 * playwright.config.ts) and only run via `npm run test:destructive:*` with --workers=1, so
 * reusing cashier 1 here never collides with the parallel pool's worker 0.
 *
 * Run: npm run test:destructive:local (or test:destructive:dev)
 */
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';

test.use({ storageState: path.join(__dirname, '../../playwright/.auth/user-0.json') });
test.setTimeout(180_000);

const INITIAL_CASH = 100;
const SALE_COUNT = 3;

// ── helpers (adapted from pos-payment.spec.ts / pos-shifts.real.spec.ts) ────

async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
  const storageState = await page.context().storageState();
  const token = storageState.cookies.find((c) => c.name === 'access_token')?.value;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Cookie = `access_token=${token}`;
  }
  if (config.tenantId) headers['X-Tenant-Id'] = config.tenantId;
  return headers;
}

type ActiveShift = {
  id: number;
  paymentReconciliations: { paymentMethodId: number; paymentMethodName: string; expectedAmount: number }[];
};

async function getActiveShift(page: Page): Promise<ActiveShift | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/shifts/active?includeExpectations=true`, {
    // Absolute URL + no-cache on purpose: see login-rate-limit/pos-shifts.real gotchas —
    // relative paths hit the SPA, and page.request can replay a stale cached 200/204.
    // includeExpectations=true is required or the backend returns paymentReconciliations: [].
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  return res.status() === 200 ? ((await res.json()) as ActiveShift) : null;
}

/** Closes a pre-existing shift for this cashier via the API, ignoring reconciliation accuracy —
 * this is only cleanup so the test below starts from a known, empty state.
 *
 * Uses the self-service `/shifts/close` endpoint (shifts:close_own), NOT `/shifts/{id}/close`
 * (shifts:close_any). The admin-only route always requires a non-empty paymentReconciliations
 * array; when a shift has none configured yet, mapping over it stays empty and the backend
 * rejects it with 400 "Payment reconciliations are required for admin closures" even though this
 * cashier owns the shift. `/shifts/close` has a finalCash fallback for exactly this case. */
async function closeShiftViaApi(page: Page, shift: ActiveShift): Promise<void> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.post(`${config.apiRoot}/shifts/close`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      closeNote: 'Auto-closed by shift-reconciliation.real.spec.ts setup',
      finalCash: 0,
      paymentReconciliations: shift.paymentReconciliations.map((r) => ({
        paymentMethodId: r.paymentMethodId,
        countedAmount: 0,
      })),
    },
  });
  // Fail loudly instead of silently leaving the old shift open — that would surface later as a
  // confusing "Abrir Caja" not found error with no clue why.
  expect(
    res.status(),
    `Cleanup close of shift ${shift.id} failed: ${res.status()} ${await res.text()}`
  ).toBe(200);
}

async function getFirstSellableProduct(page: Page): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const stockRes = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, { headers });
  if (!stockRes.ok()) return null;
  const stockItems = (await stockRes.json()) as { skuId: number; onHandQty: number }[];
  const candidates = stockItems.filter((s) => s.onHandQty > 0).sort((a, b) => b.onHandQty - a.onHandQty);

  for (const candidate of candidates.slice(0, 5)) {
    const productRes = await page.request.get(`${config.apiRoot}/products/${candidate.skuId}`, { headers });
    if (!productRes.ok()) continue;
    const product = (await productRes.json()) as { name?: string; active?: boolean; sellableType?: string };
    if (product.active === false) continue;
    if (product.sellableType && product.sellableType !== 'PRODUCT') continue;
    if (product.name) return product.name;
  }
  return null;
}

async function addProductToCart(page: Page, productName: string): Promise<void> {
  const searchInput = page.getByTestId('pos-product-search');
  await searchInput.fill(productName.substring(0, 30));
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

  const options = page.getByRole('option');
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const text = (await option.textContent()) ?? '';
    const lower = text.toLowerCase();
    if (
      !lower.includes('sin stock') &&
      !lower.includes('out of stock') &&
      text.includes(productName.substring(0, 20))
    ) {
      await option.click();
      return;
    }
  }
  await options.first().click();
}

async function openShiftFromPos(page: Page, initialCash: number): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

  const openTrigger = page.getByTestId('pos-open-shift').first();
  await expect(openTrigger).toBeVisible({ timeout: 20_000 });
  await openTrigger.click();

  await expect(page.getByTestId('shift-initial-cash-input')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('shift-initial-cash-input').fill(String(initialCash));

  const openResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
    { timeout: 20_000 }
  );
  await page.getByTestId('shift-open-submit').click();

  expect((await openResponse).status()).toBe(200);
  await expect(page.getByTestId('pos-close-shift')).toBeVisible({ timeout: 15_000 });
}

/** Adds the product to cart, pays the exact total in cash, and returns the sale total. */
async function makeSimpleCashSale(page: Page, productName: string): Promise<number> {
  await addProductToCart(page, productName);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();

  // Force CASH explicitly instead of trusting the panel's default — this test's whole premise
  // (soldCash vs the server's CASH reconciliation) is void if some other method got selected.
  const methodSelect = page.getByTestId('payment-method-select');
  await expect(methodSelect).toBeVisible();
  const cashOption = methodSelect.locator('option[data-method-type="CASH"]');
  await expect(cashOption, 'No CASH payment method available in this tenant.').toHaveCount(1);
  const cashValue = await cashOption.getAttribute('value');
  await methodSelect.selectOption(cashValue!);

  const totalText = await page.locator('[class*="total"]').last().textContent();
  const totalAmount = totalText?.replace(/[^\d.]/g, '') ?? '0';
  await page.locator('input[type="number"]').first().fill(totalAmount);

  const saleResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
    { timeout: 20_000 }
  );
  await page.getByTestId('pm-finalize').click();
  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status()).toBe(201);
  const sale = (await saleResponse.json()) as { total: number };

  await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

  return Number(sale.total);
}

/**
 * Closes the shift from the POS header, typing the CASH counted amount to match the server's own
 * expected value (payment-reconciliation-counted-{id} / -expected-{id} test ids) so the shift
 * closes with zero discrepancy — not just a note bypassing the block.
 */
async function closeShiftFromPos(page: Page, cashPaymentMethodId: number): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

  const closeTrigger = page.getByTestId('pos-close-shift');
  await expect(closeTrigger).toBeVisible({ timeout: 20_000 });
  await closeTrigger.click();

  const closeDialog = page.getByTestId('close-shift-modal');
  await expect(closeDialog).toBeVisible({ timeout: 10_000 });

  const expectedInput = closeDialog.getByTestId(`payment-reconciliation-expected-${cashPaymentMethodId}`);
  await expect(expectedInput).toBeVisible({ timeout: 15_000 });
  const expectedText = (await expectedInput.inputValue()).replace(/[^\d.]/g, '');

  await closeDialog
    .getByTestId(`payment-reconciliation-counted-${cashPaymentMethodId}`)
    .fill(expectedText);

  const submitBtn = closeDialog.getByTestId('shift-close-submit');
  await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

  const closeResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts') && r.url().endsWith('/close'),
    { timeout: 20_000 }
  );
  await submitBtn.click();
  expect((await closeResponse).status()).toBe(200);
}

test.describe('@real @manual @shifts @shift-destructive @shift-reconciliation', () => {
  test('@real @manual open -> sell -> close: sold cash matches the server-computed expected amount', async ({
    page,
  }) => {
    // Self-contained: a shift left over from a previous failed run must not leak into this one.
    const existing = await getActiveShift(page);
    if (existing) {
      await closeShiftViaApi(page, existing);
    }

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    await openShiftFromPos(page, INITIAL_CASH);

    let soldCash = 0;
    for (let i = 0; i < SALE_COUNT; i += 1) {
      await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
      soldCash += await makeSimpleCashSale(page, productName!);
    }
    const expectedCash = INITIAL_CASH + soldCash;

    // The actual assertion: does the server's own reconciliation math match what we sold?
    const shift = await getActiveShift(page);
    expect(shift, 'Shift closed unexpectedly before reconciliation could be read.').toBeTruthy();

    const cashRow = shift!.paymentReconciliations.find((r) => /efectivo|cash/i.test(r.paymentMethodName));
    expect(
      cashRow,
      `No CASH reconciliation row found. Rows: ${JSON.stringify(shift!.paymentReconciliations)}`
    ).toBeTruthy();
    expect(
      Number(cashRow!.expectedAmount),
      `initialCash (${INITIAL_CASH}) + sold (${soldCash}) = ${expectedCash}, but the server ` +
        `computed ${cashRow!.expectedAmount} as the expected CASH amount.`
    ).toBeCloseTo(expectedCash, 1);

    await closeShiftFromPos(page, cashRow!.paymentMethodId);
  });
});
