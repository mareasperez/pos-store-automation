/**
 * Promotion rewards end to end. Promotions apply to the whole tenant, so each test creates its own
 * product and deactivates its promotion afterwards (a used promotion cannot be deleted).
 *
 * - A 2x1 sold from the POS charges only the paid units, records the reward at zero, and takes the
 *   reward out of stock.
 * - The server prices a reward from the catalog: a 50% reward sent as free is rejected (it used to
 *   pass because the expected price was derived from the charged price).
 */
import { expect, serialDescribe, test } from '@fixtures';
import { openPaymentModal } from '../../support/flows/payment.flow';
import {
  createProductWithInitialStock,
  requireCredentialsOrSkip,
} from '../../support/flows/products.flow';
import {
  createPromotionViaApi,
  deactivatePromotionViaApi,
} from '../../support/flows/promotions.flow';
import {
  cancelQuoteViaApi,
  findActiveCustomer,
  findStockWarehouse,
  getBasePresentationId,
  getWarehouseStock,
} from '../../support/flows/quotes.flow';
import { addProductToCart } from '../../support/flows/sales.flow';
import { buildApiHeaders } from '../../utils/apiHeaders';
import { config } from '@config';
import { openShiftIfPrompted } from '../../utils/shift';

test.setTimeout(120_000);

serialDescribe('@regression @pos @promotions', () => {
  // The POS never adds automatic rewards: the API sends rewardPresentationId and the frontend reads
  // rewardUnitId. Remove fixme once the gap in docs/KNOWN_GAPS.md is closed.
  test.fixme('@regression @pos @promotions @serial sells a 2x1 from the POS with the reward free', async ({
    page,
  }) => {
    requireCredentialsOrSkip();

    const suffix = Date.now();
    const product = await createProductWithInitialStock(
      page,
      `E2E 2x1 ${suffix}`,
      `E2E-2X1-${suffix}`,
      '10',
      '50',
      '30'
    );
    const presentationId = await getBasePresentationId(page, product.id);
    const stock = await findStockWarehouse(page, product.id);
    expect(stock, 'the initial stock lands in an active warehouse').toBeTruthy();
    const stockBefore = await getWarehouseStock(page, product.id, stock!.warehouseId);

    const promotion = await createPromotionViaApi(page, {
      name: `E2E 2x1 ${suffix}`,
      productId: product.id,
      presentationId,
      triggerQuantity: 2,
      rewardQuantity: 1,
      discountPercentage: 100,
    });

    try {
      await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
      await openShiftIfPrompted(page);
      await addProductToCart(page, product.name);
      await addProductToCart(page, product.name);

      // Two paid units at 50; the third one is the free reward.
      await expect(page.getByTestId('pos-cart-total')).toContainText('100');

      await openPaymentModal(page);
      await expect(page.getByTestId('pm-total-base')).toContainText('100');
      await page.getByTestId('payment-amount-input').fill('100');

      const saleResponse = page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/sales$/.test(new URL(r.url()).pathname),
        { timeout: 20_000 }
      );
      await page.getByTestId('pm-finalize').click();
      const saleResult = await saleResponse;
      expect(saleResult.status(), await saleResult.text()).toBe(201);
      const sale = (await saleResult.json()) as {
        total: number;
        lines: Array<{ productId: number; quantity: number; subtotal: number }>;
      };

      expect(sale.total).toBeCloseTo(100, 2);
      const productLines = sale.lines.filter((line) => line.productId === product.id);
      expect(productLines.map((line) => [line.quantity, line.subtotal])).toEqual(
        expect.arrayContaining([
          [2, 100],
          [1, 0],
        ])
      );

      await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('invoice-close').click();

      const stockAfter = await getWarehouseStock(page, product.id, stock!.warehouseId);
      expect(stockAfter, 'paid and free units both leave the warehouse').toBeCloseTo(
        stockBefore - 3,
        5
      );
    } finally {
      await deactivatePromotionViaApi(page, promotion);
    }
  });

  test('@regression @pos @promotions @serial rejects a 50% reward sent as free', async ({
    page,
  }) => {
    requireCredentialsOrSkip();

    const customer = await findActiveCustomer(page);
    test.skip(!customer, 'No active customer in the test tenant.');

    const suffix = Date.now();
    const product = await createProductWithInitialStock(
      page,
      `E2E half off ${suffix}`,
      `E2E-HALF-${suffix}`,
      '5',
      '40',
      '20'
    );
    const presentationId = await getBasePresentationId(page, product.id);
    const stock = await findStockWarehouse(page, product.id);
    expect(stock).toBeTruthy();

    const promotion = await createPromotionViaApi(page, {
      name: `E2E half off ${suffix}`,
      productId: product.id,
      presentationId,
      triggerQuantity: 1,
      rewardQuantity: 1,
      discountPercentage: 50,
    });

    try {
      const headers = await buildApiHeaders(page);
      const quoteWith = (rewardDiscount: number) =>
        page.request.post(`${config.apiRoot}/quotes`, {
          headers,
          data: {
            customerId: customer!.id,
            warehouseId: stock!.warehouseId,
            validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            lines: [
              { sellableType: 'PRODUCT', productId: product.id, presentationId, quantity: 1 },
              {
                sellableType: 'PRODUCT',
                productId: product.id,
                presentationId,
                quantity: 1,
                discount: rewardDiscount,
                promotionId: promotion.id,
              },
            ],
          },
        });

      const free = await quoteWith(100);
      expect(free.status(), 'a 50% reward cannot be priced as free').toBe(400);
      expect(await free.text()).toContain('Invalid discount');

      const halfOff = await quoteWith(50);
      expect(halfOff.status(), await halfOff.text()).toBe(201);
      const quote = (await halfOff.json()) as { id: number; total: number };
      // 40 paid + 20 for the reward at 50% off.
      expect(quote.total).toBeCloseTo(60, 2);
      await cancelQuoteViaApi(page, quote.id);
    } finally {
      await deactivatePromotionViaApi(page, promotion);
    }
  });
});
