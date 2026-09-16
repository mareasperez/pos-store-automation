/**
 * Real POS regression coverage for rejecting FX metadata on base-currency payments.
 *
 * The UI creates a valid base-currency payment, while the route mutation injects an exchange rate
 * that would inflate a smaller amount. The real backend must reject the forged payload.
 */
import { expect, parallelDescribe, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { openPaymentModal } from '../../support/flows/payment.flow';
import {
  addProductToCart,
  getFirstSellableProduct,
} from '../../support/flows/sales.flow';
import { assertShiftStillActive } from '../../utils/shift';

parallelDescribe('@regression @pos @payment-integrity @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser, workerStorageState }) => {
    requireCredentialsOrSkip('Base-currency FX tampering regression');
    if (!config.tenantId) return;

    const context = await browser.newContext({ storageState: workerStorageState });
    const page = await context.newPage();
    productName = await getFirstSellableProduct(page);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    requireCredentialsOrSkip('Base-currency FX tampering regression');
    test.skip(!productName, 'No sellable product available in the test tenant.');
    await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
    await addProductToCart(page, productName!);
  });

  test('rejects an exchange rate injected into a base-currency payment', async ({ page }) => {
    await openPaymentModal(page);
    const totalText = await page.getByTestId('pm-total-base').textContent();
    const saleTotal = Number(totalText?.replace(/[^\d.]/g, ''));
    expect(Number.isFinite(saleTotal) && saleTotal > 0).toBe(true);
    await page.locator('input[type="number"]').first().fill(saleTotal.toFixed(2));

    await page.route('**/api/sales', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const payload = JSON.parse(route.request().postData() ?? '{}') as {
        payments?: Array<{
          amount?: number;
          tenderedAmount?: number;
          exchangeRate?: number;
          pricingAmountEquiv?: number;
        }>;
      };
      const payment = payload.payments?.[0];
      if (payment) {
        payment.amount = 2;
        payment.tenderedAmount = 2;
        payment.exchangeRate = 50;
        payment.pricingAmountEquiv = 100;
      }
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

    expect(saleResponse.status(), await saleResponse.text()).toBe(400);
    await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });
  });
});
