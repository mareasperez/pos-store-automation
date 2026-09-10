/**
 * End-to-end coverage for the full "sell -> return" lifecycle: NIO cash payment and mixed
 * (split CASH+CARD) payment, verifying both sides of a return independently:
 *  - the money: `totalRefunded` matches what was actually sold;
 *  - the product: on-hand stock goes back up by the returned quantity, regardless of currency
 *    or payment-method mix (stock is a physical fact, not a monetary one).
 *
 * These are base-currency (NIO) flows only — see return-cash-currency-mismatch.real.spec.ts for
 * the foreign-currency (USD) refund-drawer regression.
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  buildApiHeaders,
  createSimpleCashSaleViaPos,
  getFirstSellableProductWithStock,
  getPresentationConversionFactor,
  getProductStock,
} from '../../support/flows/sales.flow';

test.setTimeout(90_000);

type CreatedSaleLine = {
  id: number;
  productId: number;
  presentationId: number;
  quantity: number;
  presentationPrice: number;
};

type CreatedSale = {
  id: number;
  total: number;
  lines: CreatedSaleLine[];
};

type CreatedReturn = {
  id: number;
  totalRefunded: number;
  status: string;
};

async function getFirstWarehouseId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers });
  if (!res.ok()) return null;
  const warehouses = (await res.json()) as { id: number }[];
  return warehouses[0]?.id ?? null;
}

/** The active shift's base-currency CASH payment method (the one refunds land on). */
async function getBaseCashMethodId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  if (!res.ok()) return null;
  const methods = (await res.json()) as {
    id: number;
    type: string;
    active: boolean;
    currency: string;
  }[];
  return methods.find((m) => m.type === 'CASH' && m.active && m.currency !== 'USD')?.id ?? null;
}

/**
 * The shift's expected cash for a given payment method, straight from the server's own
 * reconciliation math (not re-derived client-side) — this is the actual money ledger, as
 * opposed to `ReturnDTO.totalRefunded`, which is just what the return record claims happened.
 */
async function getShiftExpectedAmount(page: Page, paymentMethodId: number): Promise<number> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/shifts/active?includeExpectations=true`, {
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  if (res.status() !== 200) return 0;
  const shift = (await res.json()) as {
    paymentReconciliations: { paymentMethodId: number; expectedAmount: number }[];
  };
  return (
    shift.paymentReconciliations.find((r) => r.paymentMethodId === paymentMethodId)
      ?.expectedAmount ?? 0
  );
}

/** Fully returns every line of the given sale and returns the created ReturnDTO. */
async function returnFullSale(page: Page, sale: CreatedSale, warehouseId: number) {
  const headers = await buildApiHeaders(page);
  const res = await page.request.post(`${config.apiRoot}/returns`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      saleId: sale.id,
      warehouseId,
      reasonType: 'CUSTOMER_REGRET',
      refundMethod: 'CASH',
      notes: null,
      items: sale.lines.map((line) => ({
        saleLineId: line.id,
        productId: line.productId,
        presentationId: line.presentationId,
        quantity: line.quantity,
      })),
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as CreatedReturn;
}

/** Returns only `quantity` units of a single sale line (partial return). */
async function returnPartialLine(
  page: Page,
  sale: CreatedSale,
  line: CreatedSaleLine,
  quantity: number,
  warehouseId: number
) {
  const headers = await buildApiHeaders(page);
  const res = await page.request.post(`${config.apiRoot}/returns`, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    data: {
      saleId: sale.id,
      warehouseId,
      reasonType: 'CUSTOMER_REGRET',
      refundMethod: 'CASH',
      notes: null,
      items: [
        {
          saleLineId: line.id,
          productId: line.productId,
          presentationId: line.presentationId,
          quantity,
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as CreatedReturn;
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

async function openShiftIfPrompted(page: Page): Promise<void> {
  const headers = await buildApiHeaders(page);
  const activeRes = await page.request.get(`${config.apiRoot}/shifts/active`, {
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  if (activeRes.status() === 200) return;

  const openBtn = page.locator('[data-testid="pos-open-shift"]:visible');
  await expect(openBtn).toBeAttached({ timeout: 20_000 });
  await openBtn.click();
  const cashInput = page.getByTestId('shift-initial-cash-input');
  await expect(cashInput).toBeVisible({ timeout: 8_000 });
  await cashInput.fill('1');

  const openResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
    { timeout: 20_000 }
  );
  await page.getByTestId('shift-open-submit').click();
  expect((await openResponse).status()).toBeLessThan(300);
}

/** Sells one unit split half CASH / half CARD (both in NIO) and returns the created sale. */
async function makeMixedPaymentSale(page: Page, productName: string): Promise<CreatedSale> {
  await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
  await addProductToCart(page, productName);
  await openShiftIfPrompted(page);

  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('pm-mode-advanced').click();
  await expect(page.getByRole('button', { name: /agregar pago|add payment/i })).toBeVisible({
    timeout: 5_000,
  });

  await page.getByRole('button', { name: /efectivo|cash/i }).first().click();
  const amountInput = page.locator('input[type="number"]').first();
  const totalText = await page.locator('[class*="total"]').last().textContent();
  const total = parseFloat(totalText?.replace(/[^\d.]/g, '') ?? '10');
  const half = (total / 2).toFixed(2);
  await amountInput.fill(half);
  await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

  await page.getByRole('button', { name: /tarjeta|card/i }).first().click();
  await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

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

async function sellMultipleUnitsCashNio(
  page: Page,
  productName: string,
  units: number
): Promise<CreatedSale> {
  await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
  for (let i = 0; i < units; i += 1) {
    await addProductToCart(page, productName);
  }
  await openShiftIfPrompted(page);

  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible({ timeout: 10_000 });

  const totalText = await page.locator('[class*="total"]').last().textContent();
  const totalAmount = totalText?.replace(/[^\d.]/g, '') ?? '10.00';
  await page.locator('input[type="number"]').first().fill(totalAmount);

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

test.describe('@regression @pos @returns @session-mc-20260909', () => {
  test("partial return: returning 1 of 2 sold units refunds proportionally and restores only that unit's stock", async ({
    page,
  }) => {
    requireCredentialsOrSkip('partial return flow');

    const product = await getFirstSellableProductWithStock(page);
    test.skip(
      !product || product.onHandQty < 2,
      'No product with at least 2 units of stock in the test tenant.'
    );

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    const stockBefore = await getProductStock(page, product!.skuId);

    const sale = await sellMultipleUnitsCashNio(page, product!.name, 2);
    const soldLine = sale.lines.find((line) => line.productId === product!.skuId);
    expect(soldLine, `Sale #${sale.id} has no line for product #${product!.skuId}`).toBeTruthy();
    expect(
      soldLine!.quantity,
      'Adding the same product twice should merge into one line with quantity=2.'
    ).toBe(2);

    const conversionFactor = await getPresentationConversionFactor(
      page,
      soldLine!.productId,
      soldLine!.presentationId
    );
    const stockAfterSale = await getProductStock(page, product!.skuId);

    const cashMethodId = await getBaseCashMethodId(page);
    test.skip(!cashMethodId, 'No active base-currency CASH payment method in the test tenant.');
    const cashExpectedBeforeReturn = await getShiftExpectedAmount(page, cashMethodId!);

    // Return only 1 of the 2 sold units.
    const created = await returnPartialLine(page, sale, soldLine!, 1, warehouseId!);

    const stockAfterReturn = await getProductStock(page, product!.skuId);
    const cashExpectedAfterReturn = await getShiftExpectedAmount(page, cashMethodId!);
    console.log(
      `[pos-return-flows] partial return: sold=2 returned=1 unitPrice=${soldLine!.presentationPrice} ` +
        `totalRefunded=${created.totalRefunded} stockBefore=${stockBefore} ` +
        `stockAfterSale=${stockAfterSale} stockAfterReturn=${stockAfterReturn} ` +
        `cashExpectedBeforeReturn=${cashExpectedBeforeReturn} cashExpectedAfterReturn=${cashExpectedAfterReturn}`
    );

    // The money (the return record): refund must cover exactly 1 unit, not the full 2-unit sale.
    expect(created.totalRefunded).toBeCloseTo(soldLine!.presentationPrice, 2);

    // The money (the actual shift ledger): the CASH drawer's expected amount must drop by exactly
    // what was refunded — not by the full sale, and not by nothing.
    expect(
      cashExpectedAfterReturn,
      `Shift CASH expected amount should drop by the refunded amount ` +
        `(${created.totalRefunded}). Before: ${cashExpectedBeforeReturn}, after: ${cashExpectedAfterReturn}.`
    ).toBeCloseTo(cashExpectedBeforeReturn - created.totalRefunded, 2);

    // The product: stock must go up by exactly 1 unit's worth of base units — not the full 2,
    // and not 0 — regardless of whether the refund amount above is correct.
    expect(
      stockAfterReturn,
      `Returning 1 of 2 units should restore exactly 1 unit (${conversionFactor} base units). ` +
        `stockAfterSale=${stockAfterSale}, stockAfterReturn=${stockAfterReturn}.`
    ).toBeCloseTo(stockAfterSale + conversionFactor, 5);

    // Sanity: the partial return must NOT fully restore stock to the pre-sale level — that
    // would mean it silently returned both units instead of just one.
    expect(stockAfterReturn).not.toBeCloseTo(stockBefore, 5);
  });

  test('NIO cash sale + full return: refunds the full amount and restores the sold stock', async ({
    page,
  }) => {
    requireCredentialsOrSkip('NIO cash sale + return flow');

    const product = await getFirstSellableProductWithStock(page);
    test.skip(!product, 'No sellable product with stock in the test tenant.');

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    const stockBefore = await getProductStock(page, product!.skuId);

    const sale = (await createSimpleCashSaleViaPos(
      page,
      product!.name
    )) as unknown as CreatedSale;
    const soldLine = sale.lines.find((line) => line.productId === product!.skuId);
    expect(soldLine, `Sale #${sale.id} has no line for product #${product!.skuId}`).toBeTruthy();

    const stockAfterSale = await getProductStock(page, product!.skuId);
    const cashMethodId = await getBaseCashMethodId(page);
    test.skip(!cashMethodId, 'No active base-currency CASH payment method in the test tenant.');
    const cashExpectedBeforeReturn = await getShiftExpectedAmount(page, cashMethodId!);
    console.log(
      `[pos-return-flows] NIO cash: stockBefore=${stockBefore} stockAfterSale=${stockAfterSale} ` +
        `saleTotal=${sale.total} cashExpectedBeforeReturn=${cashExpectedBeforeReturn}`
    );

    const created = await returnFullSale(page, sale, warehouseId!);
    const cashExpectedAfterReturn = await getShiftExpectedAmount(page, cashMethodId!);

    console.log(
      `[pos-return-flows] NIO cash: return #${created.id} totalRefunded=${created.totalRefunded} ` +
        `(expected ~${sale.total}) cashExpectedAfterReturn=${cashExpectedAfterReturn}`
    );
    // The money (the return record): the return must refund exactly what was charged.
    expect(created.totalRefunded).toBeCloseTo(sale.total, 2);

    // The money (the actual shift ledger): the CASH drawer's expected amount must drop by the
    // refunded amount, proving the refund is a real cash movement, not just a database field.
    expect(
      cashExpectedAfterReturn,
      `Shift CASH expected amount should drop by the refunded amount (${created.totalRefunded}). ` +
        `Before: ${cashExpectedBeforeReturn}, after: ${cashExpectedAfterReturn}.`
    ).toBeCloseTo(cashExpectedBeforeReturn - created.totalRefunded, 2);

    // The product: stock must come back regardless of the money side being correct or not.
    const stockAfterReturn = await getProductStock(page, product!.skuId);
    expect(
      stockAfterReturn,
      `Returned quantity should restore stock to the pre-sale level. ` +
        `Before sale: ${stockBefore}, after sale: ${stockAfterSale}, after return: ${stockAfterReturn}.`
    ).toBeCloseTo(stockBefore, 5);
  });

  test('mixed CASH+CARD sale + full return: refunds the full amount and restores the sold stock', async ({
    page,
  }) => {
    requireCredentialsOrSkip('mixed payment sale + return flow');

    const product = await getFirstSellableProductWithStock(page);
    test.skip(!product, 'No sellable product with stock in the test tenant.');

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    const stockBefore = await getProductStock(page, product!.skuId);

    const sale = await makeMixedPaymentSale(page, product!.name);
    const soldLine = sale.lines.find((line) => line.productId === product!.skuId);
    expect(soldLine, `Sale #${sale.id} has no line for product #${product!.skuId}`).toBeTruthy();

    const stockAfterSale = await getProductStock(page, product!.skuId);
    const cashMethodId = await getBaseCashMethodId(page);
    test.skip(!cashMethodId, 'No active base-currency CASH payment method in the test tenant.');
    const cashExpectedBeforeReturn = await getShiftExpectedAmount(page, cashMethodId!);
    console.log(
      `[pos-return-flows] mixed CASH+CARD: stockBefore=${stockBefore} ` +
        `stockAfterSale=${stockAfterSale} saleTotal=${sale.total} ` +
        `cashExpectedBeforeReturn=${cashExpectedBeforeReturn}`
    );

    const created = await returnFullSale(page, sale, warehouseId!);
    const cashExpectedAfterReturn = await getShiftExpectedAmount(page, cashMethodId!);

    console.log(
      `[pos-return-flows] mixed CASH+CARD: return #${created.id} ` +
        `totalRefunded=${created.totalRefunded} (expected ~${sale.total}) ` +
        `cashExpectedAfterReturn=${cashExpectedAfterReturn}`
    );
    // The money (the return record): the return must refund exactly what was charged, regardless
    // of how many payment methods were combined to pay for it.
    expect(created.totalRefunded).toBeCloseTo(sale.total, 2);

    // The money (the actual shift ledger): refundMethod=CASH means the FULL refund exits the
    // CASH drawer as a single movement, even though only half the sale was originally paid in
    // cash (the other half was CARD). That is the system's current, real behavior — this asserts
    // it explicitly instead of assuming it.
    expect(
      cashExpectedAfterReturn,
      `Shift CASH expected amount should drop by the full refunded amount (${created.totalRefunded}), ` +
        `not just the cash-paid half of the original sale. Before: ${cashExpectedBeforeReturn}, ` +
        `after: ${cashExpectedAfterReturn}.`
    ).toBeCloseTo(cashExpectedBeforeReturn - created.totalRefunded, 2);

    // The product: stock must come back regardless of the payment-method split.
    const stockAfterReturn = await getProductStock(page, product!.skuId);
    expect(
      stockAfterReturn,
      `Returned quantity should restore stock to the pre-sale level. ` +
        `Before sale: ${stockBefore}, after sale: ${stockAfterSale}, after return: ${stockAfterReturn}.`
    ).toBeCloseTo(stockBefore, 5);
  });
});
