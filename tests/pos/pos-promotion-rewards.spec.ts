/**
 * Promotion rewards end to end. Promotions apply to the whole tenant, so each test creates its own
 * product and deactivates its promotion afterwards (a used promotion cannot be deleted).
 *
 * - A promotion only discounts scanned units: a 2x1, a second unit at 50% (the POS and the server
 *   round alike) and a 3x2 charge the paid units, record the others at their promotion price, and
 *   every scanned unit leaves the stock. A promotion used by a sale cannot be deleted (409).
 * - "Buy X, get Y" discounts Y only when the cashier scans it; the promotion never adds it.
 * - A promotion the cashier skips stays skipped for the rest of the sale.
 * - The server prices a reward from the catalog: a 50% reward sent as free is rejected (it used to
 *   pass because the expected price was derived from the charged price).
 */
import type { Page } from '@playwright/test';
import { expect, serialDescribe, test } from '@fixtures';
import { openPaymentModal } from '../../support/flows/payment.flow';
import {
  createProductWithInitialStock,
  requireCredentialsOrSkip,
} from '../../support/flows/products.flow';
import {
  createPromotionViaApi,
  deactivatePromotionViaApi,
  deletePromotionViaApi,
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

/** Same-product promotions sold from the POS: every unit is scanned, none is added. */
const POS_SCENARIOS = [
  {
    name: '2x1',
    price: '50',
    cost: '30',
    trigger: 1,
    reward: 1,
    discount: 100,
    scans: 2,
    total: '50',
    // [quantity, subtotal] of the paid line and of the promotion line
    lines: [
      [1, 50],
      [1, 0],
    ],
  },
  {
    name: 'second unit at 50%',
    price: '2.01',
    cost: '1',
    trigger: 1,
    reward: 1,
    discount: 50,
    scans: 2,
    total: '3.02',
    lines: [
      [1, 2.01],
      [1, 1.01],
    ],
  },
  {
    name: '3x2',
    price: '50',
    cost: '30',
    trigger: 2,
    reward: 1,
    discount: 100,
    scans: 3,
    total: '100',
    lines: [
      [2, 100],
      [1, 0],
    ],
  },
];

type CreatedSale = {
  total: number;
  lines: Array<{
    productId: number;
    quantity: number;
    subtotal: number;
    promotionId?: number | null;
  }>;
};

async function openPos(page: Page): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
  await openShiftIfPrompted(page);
}

/** Pays the cart total in cash, closes the invoice, and returns the sale the API created. */
async function payCart(page: Page, total: string): Promise<CreatedSale> {
  await openPaymentModal(page);
  await expect(page.getByTestId('pm-total-base')).toContainText(total);
  await page.getByTestId('payment-amount-input').fill(total);

  const saleResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/sales$/.test(new URL(r.url()).pathname),
    { timeout: 20_000 }
  );
  await page.getByTestId('pm-finalize').click();
  const saleResult = await saleResponse;
  expect(saleResult.status(), await saleResult.text()).toBe(201);
  const sale = (await saleResult.json()) as CreatedSale;

  await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('invoice-close').click();
  return sale;
}

serialDescribe('@regression @pos @promotions', () => {
  for (const scenario of POS_SCENARIOS) {
    test(`@regression @pos @promotions @serial sells a ${scenario.name} from scanned units`, async ({
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
        triggerQuantity: scenario.trigger,
        rewardQuantity: scenario.reward,
        discountPercentage: scenario.discount,
      });

      try {
        await openPos(page);
        for (let scan = 0; scan < scenario.scans; scan++) {
          await addProductToCart(page, product.name);
        }

        await expect(page.getByTestId('pos-cart-total')).toContainText(scenario.total);

        const sale = await payCart(page, scenario.total);
        expect(sale.total).toBeCloseTo(Number(scenario.total), 2);
        const productLines = sale.lines.filter((line) => line.productId === product.id);
        expect(productLines.map((line) => [line.quantity, line.subtotal])).toEqual(
          expect.arrayContaining(scenario.lines)
        );

        const stockAfter = await getWarehouseStock(page, product.id, stock!.warehouseId);
        expect(stockAfter, 'every scanned unit leaves the warehouse').toBeCloseTo(
          stockBefore - scenario.scans,
          5
        );

        const deleted = await deletePromotionViaApi(page, promotion.id);
        expect(deleted.status(), 'a promotion used by a sale is deactivated, not deleted').toBe(
          409
        );
      } finally {
        await deactivatePromotionViaApi(page, promotion);
      }
    });
  }

  test('@regression @pos @promotions @serial discounts another product only when it is scanned', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    requireCredentialsOrSkip();

    const suffix = Date.now();
    const trigger = await createProductWithInitialStock(
      page,
      `E2E promo X ${suffix}`,
      `E2E-PROMO-X-${suffix}`,
      '10',
      '50',
      '30'
    );
    const reward = await createProductWithInitialStock(
      page,
      `E2E promo Y ${suffix}`,
      `E2E-PROMO-Y-${suffix}`,
      '10',
      '40',
      '20'
    );
    const promotion = await createPromotionViaApi(page, {
      name: `E2E X gives Y ${suffix}`,
      productId: trigger.id,
      presentationId: await getBasePresentationId(page, trigger.id),
      triggerQuantity: 1,
      rewardQuantity: 1,
      discountPercentage: 30,
      rewardProductId: reward.id,
      rewardPresentationId: await getBasePresentationId(page, reward.id),
    });

    try {
      await openPos(page);
      await addProductToCart(page, trigger.name);
      // The promotion never adds the other product.
      await expect(page.getByTestId('pos-cart-total')).toContainText('50');

      await addProductToCart(page, reward.name);
      // 50 + 40 at 30% off.
      await expect(page.getByTestId('pos-cart-total')).toContainText('78');

      const sale = await payCart(page, '78');
      expect(sale.total).toBeCloseTo(78, 2);
      expect(sale.lines.map((line) => [line.productId, line.quantity, line.subtotal])).toEqual(
        expect.arrayContaining([
          [trigger.id, 1, 50],
          [reward.id, 1, 28],
        ])
      );
    } finally {
      await deactivatePromotionViaApi(page, promotion);
    }
  });

  test('@regression @pos @promotions @serial keeps a skipped promotion skipped for the rest of the sale', async ({
    page,
  }) => {
    requireCredentialsOrSkip();

    const suffix = Date.now();
    const product = await createProductWithInitialStock(
      page,
      `E2E skip ${suffix}`,
      `E2E-SKIP-${suffix}`,
      '10',
      '50',
      '30'
    );
    const promotion = await createPromotionViaApi(page, {
      // Must not contain the product name: the promo row and toast show it next to the cart line.
      name: `E2E skip promo ${suffix}`,
      productId: product.id,
      presentationId: await getBasePresentationId(page, product.id),
      triggerQuantity: 1,
      rewardQuantity: 1,
      discountPercentage: 100,
    });

    try {
      await openPos(page);
      await addProductToCart(page, product.name);
      await addProductToCart(page, product.name);
      await expect(page.getByTestId('pos-cart-total')).toContainText('50');

      await page.getByTitle('Omitir promoción en esta venta').click();
      await expect(page.getByTestId('pos-cart-total')).toContainText('100');

      // Scanning again does not bring the skipped promotion back.
      await addProductToCart(page, product.name);
      await expect(page.getByTestId('pos-cart-total')).toContainText('150');

      const sale = await payCart(page, '150');
      const productLines = sale.lines.filter((line) => line.productId === product.id);
      expect(productLines.map((line) => [line.quantity, line.subtotal])).toEqual([[3, 150]]);
      expect(productLines.every((line) => line.promotionId == null)).toBe(true);
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
