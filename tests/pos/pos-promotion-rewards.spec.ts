/**
 * Promotion rewards end to end. Promotions apply to the whole tenant, so each test creates its own
 * product and deactivates its promotion afterwards (a used promotion cannot be deleted).
 *
 * - A promotion only discounts scanned units: two scanned units of a 2x1 charge one, record the
 *   other at its promotion price, and both leave the stock. A second unit at 50% proves the POS and
 *   the server round the reward price the same way.
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

const POS_SCENARIOS = [
  { name: '2x1', price: '50', cost: '30', discount: 100, total: '50', paid: 50, reward: 0 },
  {
    name: 'second unit at 50%',
    price: '2.01',
    cost: '1',
    discount: 50,
    total: '3.02',
    paid: 2.01,
    reward: 1.01,
  },
];

serialDescribe('@regression @pos @promotions', () => {
  for (const scenario of POS_SCENARIOS) {
    test(`@regression @pos @promotions @serial sells a ${scenario.name} from two scanned units`, async ({
      page,
    }) => {
      requireCredentialsOrSkip();

      const suffix = Date.now();
      const product = await createProductWithInitialStock(
        page,
        `E2E promo ${suffix}`,
        `E2E-PROMO-${suffix}`,
        '10',
        scenario.price,
        scenario.cost
      );
      const presentationId = await getBasePresentationId(page, product.id);
      const stock = await findStockWarehouse(page, product.id);
      expect(stock, 'the initial stock lands in an active warehouse').toBeTruthy();
      const stockBefore = await getWarehouseStock(page, product.id, stock!.warehouseId);

      const promotion = await createPromotionViaApi(page, {
        name: `E2E ${scenario.name} ${suffix}`,
        productId: product.id,
        presentationId,
        triggerQuantity: 1,
        rewardQuantity: 1,
        discountPercentage: scenario.discount,
      });

      try {
        await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
        await openShiftIfPrompted(page);
        await addProductToCart(page, product.name);
        await addProductToCart(page, product.name);

        // One unit is paid in full; the other one gets the promotion price.
        await expect(page.getByTestId('pos-cart-total')).toContainText(scenario.total);

        await openPaymentModal(page);
        await expect(page.getByTestId('pm-total-base')).toContainText(scenario.total);
        await page.getByTestId('payment-amount-input').fill(scenario.total);

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

        expect(sale.total).toBeCloseTo(Number(scenario.total), 2);
        const productLines = sale.lines.filter((line) => line.productId === product.id);
        expect(productLines.map((line) => [line.quantity, line.subtotal])).toEqual(
          expect.arrayContaining([
            [1, scenario.paid],
            [1, scenario.reward],
          ])
        );

        await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 10_000 });
        await page.getByTestId('invoice-close').click();

        const stockAfter = await getWarehouseStock(page, product.id, stock!.warehouseId);
        expect(stockAfter, 'both scanned units leave the warehouse').toBeCloseTo(
          stockBefore - 2,
          5
        );
      } finally {
        await deactivatePromotionViaApi(page, promotion);
      }
    });
  }

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
