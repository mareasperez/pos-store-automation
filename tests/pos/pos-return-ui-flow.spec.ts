/**
 * E2E coverage for the Returns UI wizard itself (`/sales/returns`, `CustomerReturnPage`) — every
 * other return spec in this repo (`pos-return-flows.spec.ts`,
 * `shifts/return-cash-currency-mismatch.real.spec.ts`) drives `POST /api/returns` directly via
 * `page.request` and never opens the modal. This spec drives the wizard end to end AND validates
 * that the refund was actually applied correctly server-side — not just that the happy-path UI
 * flow completes:
 *  - `ReturnDTO` fields (`status`, `totalRefunded`, `refundPaymentMethodId`, `itemCount`) match
 *    what was submitted.
 *  - The CASH payment method's shift reconciliation `expectedAmount` decreases by exactly the
 *    refunded amount (the actual money ledger, not just the DTO's claim).
 *  - On-hand stock for every returned product increases by the correct base-unit quantity
 *    (quantity × presentation conversion factor).
 *
 * A fresh sale is created via the real POS UI (`createSimpleCashSaleViaPos`) instead of reusing an
 * arbitrary existing sale, for two reasons: (1) it guarantees the sale hasn't already been
 * returned (avoids "quantity already returned" 400s on reruns), and (2) the walk-in/default
 * customer POS assigns to it already has prior completed sales in any real test tenant, so it
 * satisfies the backend's `hasSales` (>1 completed sale) filter without extra fixture setup.
 *
 * Tag: @shift-serial — opens a shift (via `createSimpleCashSaleViaPos`) and asserts on its live
 * CASH expected amount, so it must not run concurrently with other shift-mutating specs pinned to
 * the same cashier. Run via `npm run test:serial:local` (or `test:serial:dev`).
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  buildApiHeaders,
  createSimpleCashSaleViaPos,
  getFirstSellableProduct,
  getPresentationConversionFactor,
  getProductStock,
} from '../../support/flows/sales.flow';

test.setTimeout(90_000);

type CustomerWithSales = { id: number; name: string };
type PaymentMethod = { id: number; type: string; active: boolean };
type SaleLine = { id: number; productId: number; presentationId: number; quantity: number };
type SaleDetail = {
  id: number;
  customerId: number;
  total: number;
  status: string;
  lines: SaleLine[];
};
type PaymentReconciliation = { paymentMethodId: number; expectedAmount: number };
type ActiveShift = { paymentReconciliations: PaymentReconciliation[] };
type ReturnDTO = {
  id: number;
  status: string;
  totalRefunded: number;
  refundPaymentMethodId: number | null;
  itemCount: number;
};

async function getCustomersWithSales(page: Page): Promise<CustomerWithSales[]> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/customers`, {
    headers,
    params: { hasSales: 'true' },
  });
  if (!res.ok()) return [];
  return (await res.json()) as CustomerWithSales[];
}

async function getFirstActiveCashPaymentMethod(page: Page): Promise<PaymentMethod | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  if (!res.ok()) return null;
  const methods = (await res.json()) as PaymentMethod[];
  return methods.find((m) => m.type === 'CASH' && m.active) ?? null;
}

async function getSaleDetail(page: Page, saleId: number): Promise<SaleDetail> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/sales/${saleId}`, { headers });
  expect(res.ok(), `GET /sales/${saleId} failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as SaleDetail;
}

async function getCustomerName(page: Page, customerId: number): Promise<string> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/customers/${customerId}`, { headers });
  expect(res.ok(), `GET /customers/${customerId} failed: ${res.status()}`).toBeTruthy();
  const customer = (await res.json()) as { name: string };
  return customer.name;
}

async function getFirstWarehouseId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers });
  if (!res.ok()) return null;
  const warehouses = (await res.json()) as { id: number }[];
  return warehouses[0]?.id ?? null;
}

async function getActiveShift(page: Page): Promise<ActiveShift | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/shifts/active?includeExpectations=true`, {
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  return res.status() === 200 ? ((await res.json()) as ActiveShift) : null;
}

function expectedAmountFor(shift: ActiveShift, paymentMethodId: number): number {
  return (
    shift.paymentReconciliations.find((r) => r.paymentMethodId === paymentMethodId)
      ?.expectedAmount ?? 0
  );
}

/** Sum of (quantity converted to base units) per distinct product across the sale's lines. */
async function computeExpectedBaseUnitReturn(
  page: Page,
  lines: SaleLine[]
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    const factor = await getPresentationConversionFactor(page, line.productId, line.presentationId);
    const baseUnits = line.quantity * factor;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + baseUnits);
  }
  return totals;
}

test.describe('@regression @pos @returns @shift-serial @session-mc-20260910', () => {
  test('registers a return through the UI and verifies refund, shift cash and stock effects', async ({
    page,
  }) => {
    requireCredentialsOrSkip('returns UI flow');

    const cashMethod = await getFirstActiveCashPaymentMethod(page);
    test.skip(!cashMethod, 'No active CASH payment method in the test tenant.');

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    // Fresh sale, guaranteed unreturned, via the real POS UI (also opens a shift if needed).
    const createdSale = await createSimpleCashSaleViaPos(page, productName!);
    const sale = await getSaleDetail(page, createdSale.id);
    expect(sale.status, 'Sale was not COMPLETED right after checkout.').toBe('COMPLETED');

    const customers = await getCustomersWithSales(page);
    test.skip(
      !customers.some((c) => c.id === sale.customerId),
      `Sale customer #${sale.customerId} does not yet have >1 completed sale in this tenant ` +
        '(hasSales filter empty for it) — cannot exercise the Returns customer dropdown.'
    );
    const customerName = await getCustomerName(page, sale.customerId);

    const expectedBaseUnitsByProduct = await computeExpectedBaseUnitReturn(page, sale.lines);
    const stockBefore = new Map<number, number>();
    for (const productId of expectedBaseUnitsByProduct.keys()) {
      stockBefore.set(productId, await getProductStock(page, productId));
    }

    const shiftBefore = await getActiveShift(page);
    expect(shiftBefore, 'No active shift found right after creating the sale.').toBeTruthy();
    const cashExpectedBefore = expectedAmountFor(shiftBefore!, cashMethod!.id);

    await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('customer-return-open-create').click();

    await page.getByTestId('customer-return-customer-search').click();
    await page.getByRole('listbox').waitFor({ state: 'visible' });
    await page
      .getByRole('option', { name: new RegExp(customerName.substring(0, 15)) })
      .first()
      .click();

    await page.getByTestId('customer-return-sale-search').click();
    await page.getByRole('listbox').waitFor({ state: 'visible' });
    await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();

    await page
      .getByTestId('customer-return-warehouse-select')
      .selectOption({ value: String(warehouseId) });

    await expect(page.getByTestId('customer-return-continue')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('customer-return-continue').click();

    await page.getByTestId('customer-return-select-all').click();

    const refundPaymentSelect = page.getByTestId('customer-return-refund-payment-method-select');
    if (await refundPaymentSelect.isVisible()) {
      await refundPaymentSelect.selectOption({ value: String(cashMethod!.id) });
    }

    const returnResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/returns') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.getByTestId('customer-return-submit').click();
    const returnResponse = await returnResponsePromise;
    expect(returnResponse.status(), await returnResponse.text()).toBe(200);
    const returnDto = (await returnResponse.json()) as ReturnDTO;

    // ── DTO correctness ──────────────────────────────────────────────────────────────────────
    expect(returnDto.status).toBe('POSTED');
    expect(returnDto.refundPaymentMethodId).toBe(cashMethod!.id);
    expect(returnDto.itemCount).toBe(sale.lines.length);
    expect(
      Math.abs(Number(returnDto.totalRefunded) - sale.total),
      `totalRefunded (${returnDto.totalRefunded}) should equal the full sale total (${sale.total}) ` +
        'since every line was returned via "select all".'
    ).toBeLessThan(0.01);

    // Modal closes on success and the wizard resets.
    await expect(page.getByTestId('customer-return-submit')).not.toBeVisible({ timeout: 10_000 });

    // ── Real money ledger: the CASH drawer must drop by exactly the refunded amount ─────────
    const shiftAfter = await getActiveShift(page);
    expect(shiftAfter, 'Shift closed unexpectedly after the return.').toBeTruthy();
    const cashExpectedAfter = expectedAmountFor(shiftAfter!, cashMethod!.id);
    expect(
      Math.abs(cashExpectedAfter - (cashExpectedBefore - Number(returnDto.totalRefunded))),
      `CASH drawer expected amount should drop by totalRefunded ` +
        `(before=${cashExpectedBefore}, after=${cashExpectedAfter}, refunded=${returnDto.totalRefunded}).`
    ).toBeLessThan(0.01);

    // ── Physical stock: every returned product must gain back its base-unit quantity ────────
    for (const [productId, expectedDelta] of expectedBaseUnitsByProduct) {
      const stockAfter = await getProductStock(page, productId);
      const actualDelta = stockAfter - (stockBefore.get(productId) ?? 0);
      expect(
        actualDelta,
        `Product #${productId} on-hand stock should increase by ${expectedDelta} base units ` +
          `after the return (actual delta=${actualDelta}).`
      ).toBeCloseTo(expectedDelta, 2);
    }
  });
});
