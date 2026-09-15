/**
 * Real POS regression coverage for applied-payment shortfalls.
 *
 * The UI starts with an exact payment. The route mutation simulates a stale or incorrect client
 * payload that is one cent below the sale total; the backend must reject it without creating an
 * invoice.
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

test.describe('@regression @pos @payment-shortfall @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser, workerStorageState }) => {
    requireCredentialsOrSkip('Payment shortfall regression');
    if (!config.tenantId) {
      console.warn('[E2E] TEST_TENANT_ID not set — skipping payment shortfall test.');
      return;
    }

    const context = await browser.newContext({ storageState: workerStorageState });
    const page = await context.newPage();
    productName = await getFirstSellableProduct(page);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    requireCredentialsOrSkip('Payment shortfall regression');
    test.skip(!productName, 'No sellable product available in the test tenant.');
    await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
    await addProductToCart(page, productName!);
  });

  test('backend rejects an applied payment shortfall', async ({ page }) => {
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
        payments?: Array<{ amount?: number; tenderedAmount?: number }>;
      };
      const payment = payload.payments?.[0];
      if (payment?.amount == null) {
        await route.continue();
        return;
      }

      const shortfall = Number((payment.amount - 0.01).toFixed(2));
      payment.amount = shortfall;
      payment.tenderedAmount = shortfall;
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