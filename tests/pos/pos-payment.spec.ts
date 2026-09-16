/**
 * PaymentManager E2E — simple-mode and advanced-mode real sales flows.
 *
 * Prerequisites (in the TEST_TENANT_ID tenant):
 *  - At least one active product with stock available
 *  - CASH and CARD payment methods active in NIO
 *  - A shift can be opened from the POS UI
 *
 * These tests create real sale records in the test tenant.
 */
import { expect, parallelDescribe, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  addProductToCart,
  getFirstSellableProduct,
} from '../../support/flows/sales.flow';
import {
  findActiveUsdCashMethod,
  getUsdExchangeRate,
  openPaymentModal,
} from '../../support/flows/payment.flow';
import { buildApiHeaders } from '../../utils/apiHeaders';
import { assertShiftStillActive } from '../../utils/shift';

parallelDescribe('@regression @pos @payment-manager @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser, workerStorageState }) => {
    requireCredentialsOrSkip('PaymentManager POS flows');
    if (!config.tenantId) {
      console.warn('[E2E] TEST_TENANT_ID not set — skipping POS payment tests.');
      return;
    }
    // Resolve a sellable product once for all tests in this suite
    const ctx = await browser.newContext({ storageState: workerStorageState });
    const p = await ctx.newPage();
    productName = await getFirstSellableProduct(p);
    await ctx.close();

    if (!productName) {
      console.warn('[E2E] No sellable product found in tenant — tests will be skipped.');
    }
  });

  test.beforeEach(async ({ page }) => {
    requireCredentialsOrSkip('PaymentManager POS flows');
    if (!productName) {
      test.skip(true, 'No sellable product available in the test tenant.');
    }
    await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
    await addProductToCart(page, productName!);
  });

  // ── Simple mode (single CASH payment) ────────────────────────────────────

  test('simple-mode cash payment completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Should be in simple mode by default
    await expect(page.getByTestId('pm-mode-simple')).toBeVisible();

    // Enter tendered amount equal to total
    const totalText = await page.getByTestId('pm-total-base').textContent();
    const totalAmount = totalText?.replace(/[^\d.]/g, '') ?? '10.00';

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(totalAmount);

    // Confirm sale
    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    const saleBody = (await saleResponse.json()) as {
      id?: number;
      total?: number;
      customerName?: string;
    };

    // PaymentManager closes, invoice dialog opens
    await expect(page.getByTestId('pm-dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
    await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

    return saleBody.id;
  });

  test('sale appears in history with correct product and total', async ({ page }) => {
    const headers = await buildApiHeaders(page);
    await openPaymentModal(page);

    await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
    const totalText = await page.getByTestId('pm-total-base').textContent();
    const expectedTotal = totalText?.replace(/[^\d.]/g, '') ?? '0';

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(expectedTotal);

    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;
    expect(saleResponse.status()).toBe(201);
    const sale = (await saleResponse.json()) as {
      id: number;
      total: number;
      customerName?: string;
      lines?: { productName?: string; quantity?: number; presentationPrice?: number }[];
    };

    await page.getByTestId('invoice-close').click();

    // Verify in history API
    const histRes = await page.request.get(`${config.apiRoot}/sales/${sale.id}`, { headers });
    expect(histRes.status()).toBe(200);
    const detail = (await histRes.json()) as typeof sale;

    expect(detail.id).toBe(sale.id);
    expect(Number(detail.total)).toBeCloseTo(Number(expectedTotal), 1);
    expect(detail.lines?.length).toBeGreaterThan(0);
    const line = detail.lines![0];
    expect(line.productName).toBeTruthy();
    expect(Number(line.quantity)).toBeGreaterThan(0);
    expect(Number(line.presentationPrice)).toBeGreaterThan(0);
  });

  // ── Advanced mode (split payment: cash + card) ────────────────────────────

  test('advanced-mode split payment across two methods completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Switch to advanced mode
    await page.getByTestId('pm-mode-advanced').click();
    await expect(page.getByRole('button', { name: /agregar pago|add payment/i })).toBeVisible({
      timeout: 5_000,
    });

    // Add a partial CASH payment (half the total, approx)
    const cashMethodBtn = page.getByRole('button', { name: /efectivo|cash/i }).first();
    await cashMethodBtn.click();

    const amountInput = page.locator('input[type="number"]').first();
    const totalText = await page.getByTestId('pm-total-base').textContent();
    const total = parseFloat(totalText?.replace(/[^\d.]/g, '') ?? '10');
    const half = (total / 2).toFixed(2);

    await amountInput.fill(half);
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    // Add remaining via CARD
    const cardMethodBtn = page.getByRole('button', { name: /tarjeta|card/i }).first();
    await cardMethodBtn.click();
    // Amount should auto-fill the remaining
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    // Confirm sale
    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    await expect(page.getByTestId('pm-dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
    await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Foreign currency (secondary currency) payments ────────────────────────
  //
  // Regression coverage for the PaymentManager currency-contract fix: `amount` must stay in the
  // payment's own currency (not pre-converted to base) and `pricingAmountEquiv` must be the base
  // equivalent the backend recomputes as amount * exchangeRate. Before the fix, any secondary
  // currency payment was rejected by SaleService.resolvePricingAmountEquivalent with
  // "pricingAmountEquiv does not match the server-calculated payment equivalent".

  test('simple-mode USD cash payment completes the sale @session-mc-20260909', async ({ page }) => {
    const usdMethodCode = await findActiveUsdCashMethod(page);
    test.skip(!usdMethodCode, 'No active USD CASH payment method in the test tenant.');

    await openPaymentModal(page);

    const usdButton = page.getByTestId('pm-currency-USD');
    test.skip(!(await usdButton.isEnabled()), 'No active USD exchange rate in the test tenant.');
    await usdButton.click();
    await page.getByTestId('payment-method-select').selectOption(usdMethodCode!);

    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status(), await saleResponse.text()).toBe(201);
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
  });

  test('USD overpayment returns change in tenant base currency @regression', async ({ page }) => {
    const usdMethodCode = await findActiveUsdCashMethod(page);
    test.skip(!usdMethodCode, 'No active USD CASH payment method in the test tenant.');
    const usdRate = await getUsdExchangeRate(page);
    test.skip(!usdRate, 'No active USD exchange rate in the test tenant.');

    await openPaymentModal(page);
    const usdButton = page.getByTestId('pm-currency-USD');
    test.skip(!(await usdButton.isEnabled()), 'No active USD exchange rate in the test tenant.');
    await usdButton.click();
    await page.getByTestId('payment-method-select').selectOption(usdMethodCode!);

    const totalText = await page.getByTestId('pm-total-base').textContent();
    const saleTotal = Number(totalText?.replace(/[^\d.]/g, ''));
    expect(Number.isFinite(saleTotal) && saleTotal > 0).toBe(true);

    const tenderedUsd = Math.ceil(saleTotal / usdRate!) + 50;
    const expectedChangeBase = tenderedUsd * usdRate! - saleTotal;
    await page.locator('input[type="number"]').first().fill(tenderedUsd.toFixed(2));

    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status(), await saleResponse.text()).toBe(201);
    const sale = (await saleResponse.json()) as {
      changeDue?: number;
      payments?: { amount: number; tenderedAmount: number; paymentMethod: string }[];
    };
    expect(sale.changeDue).toBeCloseTo(expectedChangeBase, 2);
    expect(sale.payments?.[0]).toMatchObject({
      paymentMethod: usdMethodCode!,
      tenderedAmount: tenderedUsd,
    });

    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('invoice-payment-0-amount')).toHaveAttribute(
      'data-currency',
      'USD'
    );
    await expect(page.getByTestId('invoice-payment-0-equivalent')).toHaveAttribute(
      'data-currency',
      'NIO'
    );
    await expect(page.getByTestId('invoice-payment-0-received')).toHaveAttribute(
      'data-currency',
      'USD'
    );
    await expect(page.getByTestId('invoice-change-base')).toHaveAttribute(
      'data-currency',
      'NIO'
    );
    await expect(page.getByTestId('invoice-change-secondary')).toHaveAttribute(
      'data-currency',
      'USD'
    );
    await page.getByTestId('invoice-close').click();
  });

  test('advanced-mode split payment mixing base currency and USD completes the sale @session-mc-20260909', async ({
    page,
  }) => {
    const usdMethodCode = await findActiveUsdCashMethod(page);
    test.skip(!usdMethodCode, 'No active USD CASH payment method in the test tenant.');

    await openPaymentModal(page);
    await page.getByTestId('pm-mode-advanced').click();
    await expect(page.getByRole('button', { name: /agregar pago|add payment/i })).toBeVisible({
      timeout: 5_000,
    });

    // Pay half the total in base currency (NIO) cash first.
    await page
      .getByRole('button', { name: /efectivo|cash/i })
      .first()
      .click();
    const amountInput = page.locator('input[type="number"]').first();
    const totalText = await page.getByTestId('pm-total-base').textContent();
    const total = parseFloat(totalText?.replace(/[^\d.]/g, '') ?? '10');
    const half = (total / 2).toFixed(2);
    await amountInput.fill(half);
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    // Switch to USD and pay the remainder — auto-filled amount must already be capped/converted
    // against the still-outstanding base-currency balance (normalizePayments' cap-by-base fix).
    const usdButton = page.getByTestId('pm-currency-USD');
    test.skip(!(await usdButton.isEnabled()), 'No active USD exchange rate in the test tenant.');
    await usdButton.click();
    await page
      .getByRole('button', { name: /efectivo|cash/i })
      .first()
      .click();
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status(), await saleResponse.text()).toBe(201);
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
  });
});
