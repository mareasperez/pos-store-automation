/**
 * Focused coverage proving a POS sale actually decrements product stock — none of the existing
 * POS specs (pos-payment.spec.ts, sales-history-void.spec.ts) assert on inventory, only on the
 * sale/payment/history side. Picks the product with the most on-hand stock to reduce the chance
 * of colliding with another parallel worker selling the same SKU during the test run.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  createSimpleCashSaleViaPos,
  getFirstSellableProductWithStock,
  getPresentationConversionFactor,
  getProductStock,
} from '../../support/flows/sales.flow';

test.setTimeout(60_000);

test.describe('@regression @pos @inventory', () => {
  test('@regression @pos @inventory a cash sale reduces the product stock in base units', async ({
    page,
  }) => {
    requireCredentialsOrSkip('POS sale stock effect flow');

    const product = await getFirstSellableProductWithStock(page);
    test.skip(!product, 'No sellable product with stock in the test tenant.');

    const stockBefore = await getProductStock(page, product!.skuId);
    const sale = await createSimpleCashSaleViaPos(page, product!.name);

    const soldLine = sale.lines?.find((line) => line.productId === product!.skuId);
    expect(soldLine, `Sale #${sale.id} has no line for product #${product!.skuId}`).toBeTruthy();

    const conversionFactor = await getPresentationConversionFactor(
      page,
      soldLine!.productId,
      soldLine!.presentationId
    );
    const expectedBaseUnitsSold = soldLine!.quantity * conversionFactor;
    const stockAfter = await getProductStock(page, product!.skuId);

    console.log(
      `[pos-sale-stock-effect] product=${product!.name} (#${product!.skuId}) ` +
        `stockBefore=${stockBefore} quantity=${soldLine!.quantity} factor=${conversionFactor} ` +
        `expectedBaseUnitsSold=${expectedBaseUnitsSold} stockAfter=${stockAfter}`
    );

    expect(
      stockAfter,
      `Stock should drop by ${expectedBaseUnitsSold} base units after the sale. ` +
        `Before: ${stockBefore}, after: ${stockAfter}.`
    ).toBeCloseTo(stockBefore - expectedBaseUnitsSold, 5);
  });
});
