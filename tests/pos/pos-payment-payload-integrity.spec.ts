/**
 * Real POS regression coverage for server-authoritative payment metadata.
 *
 * The UI creates a valid payment, while the route mutation changes only the client-provided
 * pricingAmountEquiv. The real backend must ignore that hint, recompute the equivalent, and return
 * the persisted server value to the invoice.
 */
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { openPaymentModal } from '../../support/flows/payment.flow';
import {
  addProductToCart,
  getFirstSellableProduct,
} from '../../support/flows/sales.flow';
import { assertShiftStillActive } from '../../utils/shift';

test.describe('@regression @pos @payment-integrity @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser, workerStorageState }) => {
    requireCredentialsOrSkip('Payment payload integrity regression');
    if (!config.tenantId) {
      console.warn('[E2E] TEST_TENANT_ID not set — skipping payment integrity test.');
      return;
    }

    const context = await browser.newContext({ storageState: workerStorageState });
    const page = await context.newPage();
    productName = await getFirstSellableProduct(page);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    requireCredentialsOrSkip('Payment payload integrity regression');
    test.skip(!productName, 'No sellable product available in the test tenant.');
    await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
    await addProductToCart(page, productName!);
  });

  test('ignores a manipulated client payment equivalent', async ({ page }) => {
    await openPaymentModal(page);

    const totalText = await page.getByTestId('pm-total-base').textContent();
    const saleTotal = Number(totalText?.replace(/[^\d.]/g, ''));
    expect(Number.isFinite(saleTotal) && saleTotal > 0).toBe(true);

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(saleTotal.toFixed(2));

    await page.route('**/api/sales', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const payload = JSON.parse(route.request().postData() ?? '{}') as {
        payments?: Array<{ amount?: number; pricingAmountEquiv?: number | null }>;
      };
      const payment = payload.payments?.[0];
      if (payment?.amount == null) {
        await route.continue();
        return;
      }

      payment.pricingAmountEquiv = 0.01;
      await route.continue({ postData: JSON.stringify(payload) });
    });

    const saleResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/sales') && response.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await assertShiftStillActive(page);
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status(), await saleResponse.text()).toBe(201);
    const sale = (await saleResponse.json()) as {
      total?: number;
      payments?: Array<{ amount: number; pricingAmountEquiv: number }>;
    };

    expect(sale.payments?.[0]?.pricingAmountEquiv).toBeCloseTo(Number(sale.total), 2);
    expect(sale.payments?.[0]?.pricingAmountEquiv).not.toBe(0.01);

    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('invoice-payment-0-equivalent')).toHaveAttribute(
      'data-currency',
      'NIO'
    );
    await page.getByTestId('invoice-close').click();
  });
});
