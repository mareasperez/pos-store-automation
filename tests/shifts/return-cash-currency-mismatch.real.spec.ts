/**
 * Regression e2e for a currency-contamination bug in return refunds: `ReturnService.create` used
 * to always register the CASH refund's cash movement via
 * `shiftService.registerCashMovement(userId, "OUT", totalRefunded, reason)` — the 4-arg overload
 * that defaults to the tenant's BASE-currency CASH payment method
 * (`ShiftService.getCashPaymentMethodId()`) — regardless of which payment method/currency the
 * original sale was actually paid with.
 *
 * Fixed: the operator now explicitly selects the refund's destination payment method
 * (`paymentMethodId`, required for refundMethod CASH/CARD/TRANSFER — the system never infers
 * it). A sale paid ENTIRELY in a secondary currency (USD) and refunded into the USD CASH method
 * must move the USD drawer, and must NOT move the base-currency CASH drawer at all.
 *
 * See docs/KNOWN_GAPS.md gap #11 (Return Refund Currency Is Not Modeled) and gap #12 (Shift Cash
 * Balances Lack Explicit Currency Denomination).
 *
 * Tag: @real @manual @shift-serial — pinned to cashier 1 (user-0.json), mutates shift state (cash
 * movements), so it needs the same single-worker isolation as shift-reconciliation.real.spec.ts.
 * Run via `npm run test:serial:local` (or `test:serial:dev`).
 */
import path from 'node:path';
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { dirnameFromUrl } from '../../utils/esm';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

const dirname = dirnameFromUrl(import.meta.url);
test.use({ storageState: path.join(dirname, '../../playwright/.auth/user-0.json') });
test.setTimeout(120_000);

const INITIAL_CASH = 100;

// ── helpers (adapted from shift-reconciliation.real.spec.ts) ────────────────

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

type PaymentReconciliation = { paymentMethodId: number; expectedAmount: number };
type ActiveShift = { id: number; paymentReconciliations: PaymentReconciliation[] };

async function getActiveShift(page: Page): Promise<ActiveShift | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/shifts/active?includeExpectations=true`, {
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  return res.status() === 200 ? ((await res.json()) as ActiveShift) : null;
}

async function closeShiftViaApi(page: Page, shift: ActiveShift): Promise<void> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.post(`${config.apiRoot}/shifts/close`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      closeNote: 'Auto-closed by return-cash-currency-mismatch.real.spec.ts',
      finalCash: 0,
      paymentReconciliations: shift.paymentReconciliations.map((r) => ({
        paymentMethodId: r.paymentMethodId,
        countedAmount: 0,
      })),
    },
  });
  expect(
    res.status(),
    `Cleanup close of shift ${shift.id} failed: ${res.status()} ${await res.text()}`
  ).toBe(200);
}

type PaymentMethod = {
  id: number;
  code: string;
  type: string;
  active: boolean;
  currency: string;
};

async function getActivePaymentMethods(page: Page): Promise<PaymentMethod[]> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  expect(res.ok(), `GET /payment-methods failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as PaymentMethod[];
}

async function getFirstWarehouseId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers });
  if (!res.ok()) return null;
  const warehouses = (await res.json()) as { id: number }[];
  return warehouses[0]?.id ?? null;
}

async function getFirstSellableProduct(page: Page): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const stockRes = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, {
    headers,
  });
  if (!stockRes.ok()) return null;
  const stockItems = (await stockRes.json()) as { skuId: number; onHandQty: number }[];
  const candidates = stockItems
    .filter((s) => s.onHandQty > 0)
    .sort((a, b) => b.onHandQty - a.onHandQty);

  for (const candidate of candidates.slice(0, 5)) {
    const productRes = await page.request.get(`${config.apiRoot}/products/${candidate.skuId}`, {
      headers,
    });
    if (!productRes.ok()) continue;
    const product = (await productRes.json()) as {
      name?: string;
      active?: boolean;
      sellableType?: string;
    };
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

type CreatedSale = {
  id: number;
  total: number;
  lines: { id: number; productId: number; presentationId: number; quantity: number }[];
};

/** Pays the exact total in the given currency/payment method code and returns the created sale. */
async function makeCashSaleWithMethod(
  page: Page,
  productName: string,
  currencyCode: string,
  methodCode: string
): Promise<CreatedSale> {
  await addProductToCart(page, productName);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();

  const currencyButton = page.getByRole('button', { name: currencyCode });
  await expect(currencyButton).toBeEnabled({ timeout: 5_000 });
  await currencyButton.click();

  const methodSelect = page.getByTestId('payment-method-select');
  await expect(methodSelect).toBeVisible();
  await methodSelect.selectOption(methodCode);

  const saleResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
    { timeout: 20_000 }
  );
  await page.getByTestId('pm-finalize').click();
  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status(), await saleResponse.text()).toBe(201);
  const sale = (await saleResponse.json()) as CreatedSale;

  await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

  return sale;
}

function expectedAmountFor(shift: ActiveShift, paymentMethodId: number): number {
  return (
    shift.paymentReconciliations.find((r) => r.paymentMethodId === paymentMethodId)
      ?.expectedAmount ?? 0
  );
}

// ── test ─────────────────────────────────────────────────────────────────────

test.describe('@real @manual @shift-serial @returns-currency @session-mc-20260909', () => {
  test('@real @manual returning a USD-only sale must not move the base-currency CASH drawer', async ({
    page,
  }) => {
    requireCredentialsOrSkip('return refund currency mismatch');

    const existing = await getActiveShift(page);
    if (existing) {
      await closeShiftViaApi(page, existing);
    }

    const methods = await getActivePaymentMethods(page);
    const usdCashMethod = methods.find(
      (m) => m.type === 'CASH' && m.active && m.currency === 'USD'
    );
    test.skip(!usdCashMethod, 'No active USD CASH payment method in the test tenant.');

    const baseCashMethod = methods.find(
      (m) => m.type === 'CASH' && m.active && m.currency !== 'USD'
    );
    test.skip(!baseCashMethod, 'No active base-currency CASH payment method in the test tenant.');

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    await openShiftFromPos(page, INITIAL_CASH);

    try {
      await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
      const sale = await makeCashSaleWithMethod(page, productName!, 'USD', usdCashMethod!.code);

      const shiftAfterSale = await getActiveShift(page);
      expect(shiftAfterSale, 'Shift closed unexpectedly after the sale.').toBeTruthy();
      const baseExpectedBeforeReturn = expectedAmountFor(shiftAfterSale!, baseCashMethod!.id);
      const usdExpectedBeforeReturn = expectedAmountFor(shiftAfterSale!, usdCashMethod!.id);

      const headers = await buildApiHeaders(page);
      const returnResponse = await page.request.post(`${config.apiRoot}/returns`, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
          saleId: sale.id,
          warehouseId,
          reasonType: 'CUSTOMER_REGRET',
          refundMethod: 'CASH',
          paymentMethodId: usdCashMethod!.id,
          notes: null,
          items: sale.lines.map((line) => ({
            saleLineId: line.id,
            productId: line.productId,
            presentationId: line.presentationId,
            quantity: line.quantity,
          })),
        },
      });
      expect(returnResponse.status(), await returnResponse.text()).toBe(200);

      const shiftAfterReturn = await getActiveShift(page);
      expect(shiftAfterReturn, 'Shift closed unexpectedly after the return.').toBeTruthy();
      const baseExpectedAfterReturn = expectedAmountFor(shiftAfterReturn!, baseCashMethod!.id);
      const usdExpectedAfterReturn = expectedAmountFor(shiftAfterReturn!, usdCashMethod!.id);

      console.log(
        `[returns-currency] base drawer expected before=${baseExpectedBeforeReturn} ` +
          `after=${baseExpectedAfterReturn}; USD drawer expected before=${usdExpectedBeforeReturn} ` +
          `after=${usdExpectedAfterReturn}`
      );

      // The sale was paid ENTIRELY in USD and the operator explicitly selected the USD CASH
      // method as the refund destination — the base-currency drawer must be untouched by both the
      // sale and its return.
      expect(
        baseExpectedAfterReturn,
        'Refunding a USD-only sale into the USD payment method moved the BASE-currency CASH ' +
          `drawer's expected amount (before=${baseExpectedBeforeReturn}, after=${baseExpectedAfterReturn}). ` +
          'The refund cash movement was registered against the wrong payment method/currency.'
      ).toBeCloseTo(baseExpectedBeforeReturn, 2);

      // The USD drawer must actually receive the refund — proving the money landed in the
      // correct till, not just that it avoided the wrong one.
      expect(
        usdExpectedAfterReturn,
        `USD drawer expected amount should drop by the refunded amount. ` +
          `Before: ${usdExpectedBeforeReturn}, after: ${usdExpectedAfterReturn}.`
      ).toBeLessThan(usdExpectedBeforeReturn);
    } finally {
      // Always leave the tenant's shift closed, whether the assertion above passed or failed.
      const finalShift = await getActiveShift(page);
      if (finalShift) {
        await closeShiftViaApi(page, finalShift);
      }
    }
  });
});
