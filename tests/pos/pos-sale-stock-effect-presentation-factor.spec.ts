/**
 * Companion to pos-sale-stock-effect.spec.ts: proves the stock math also holds for a NON-base
 * presentation (e.g. a "Caja x12" with conversionFactor > 1), not just the trivial factor-1 case.
 * Skips itself when the test tenant has no product with such a presentation and enough stock —
 * this is tenant data, not something every environment is guaranteed to have.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  createSimpleCashSaleViaPos,
  findProductWithNonBasePresentation,
  getPresentationConversionFactor,
  getProductStock,
} from '../../support/flows/sales.flow';

test.setTimeout(60_000);

test.describe('@regression @pos @inventory', () => {
  test('@regression @pos @inventory a sale of a non-base presentation reduces stock by quantity x factor', async ({
    page,
  }) => {
    requireCredentialsOrSkip('POS sale stock effect (non-base presentation) flow');

    const candidate = await findProductWithNonBasePresentation(page);
    test.skip(
      !candidate,
      'No product with a non-base presentation (e.g. box/pack) and enough stock in the test tenant.'
    );

    const stockBefore = await getProductStock(page, candidate!.skuId);
    const sale = await createSimpleCashSaleViaPos(
      page,
      candidate!.productName,
      candidate!.presentationName
    );

    const soldLine = sale.lines?.find((line) => line.presentationId === candidate!.presentationId);
    expect(
      soldLine,
      `Sale #${sale.id} has no line for presentation #${candidate!.presentationId}`
    ).toBeTruthy();

    const conversionFactor = await getPresentationConversionFactor(
      page,
      soldLine!.productId,
      soldLine!.presentationId
    );
    const expectedBaseUnitsSold = soldLine!.quantity * conversionFactor;
    const stockAfter = await getProductStock(page, candidate!.skuId);

    console.log(
      `[pos-sale-stock-effect-presentation-factor] product=${candidate!.productName} ` +
        `presentation=${candidate!.presentationName} (#${candidate!.presentationId}) ` +
        `stockBefore=${stockBefore} quantity=${soldLine!.quantity} factor=${conversionFactor} ` +
        `expectedBaseUnitsSold=${expectedBaseUnitsSold} stockAfter=${stockAfter}`
    );

    expect(
      conversionFactor,
      'This test only proves something when the factor is > 1.'
    ).toBeGreaterThan(1);
    expect(
      stockAfter,
      `Stock should drop by ${expectedBaseUnitsSold} base units after the sale. ` +
        `Before: ${stockBefore}, after: ${stockAfter}.`
    ).toBeCloseTo(stockBefore - expectedBaseUnitsSold, 5);
  });
});
