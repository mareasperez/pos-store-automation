/**
 * Companion to purchase-stock-effect.spec.ts: proves the stock math also holds when purchasing a
 * NON-base presentation (e.g. a "Caja x12", conversionFactor > 1). Skips itself when the tenant
 * has no active supplier + product pair with such a presentation.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../../support/flows/auth.flow';
import {
  getPresentationConversionFactor,
  getProductStock,
} from '../../../support/flows/sales.flow';
import {
  createPurchaseWithPresentation,
  findPurchasablePairWithNonBasePresentation,
} from '../../../support/flows/purchases.flow';

test.setTimeout(60_000);

test.describe('@regression @purchases @inventory', () => {
  test('@regression @purchases @inventory a purchase of a non-base presentation increases stock by quantity x factor', async ({
    page,
  }) => {
    requireCredentialsOrSkip('purchase stock effect (non-base presentation) flow');

    const candidate = await findPurchasablePairWithNonBasePresentation(page);
    test.skip(
      !candidate,
      'No active supplier + product pair with a non-base presentation in the test tenant.'
    );

    const stockBefore = await getProductStock(page, candidate!.productId);
    const receipt = await createPurchaseWithPresentation(page, candidate!);

    const purchasedLine = receipt.lines?.find(
      (line) => line.presentationId === candidate!.presentationId
    );
    expect(
      purchasedLine,
      `Purchase #${receipt.id} has no line for presentation #${candidate!.presentationId}`
    ).toBeTruthy();

    const conversionFactor = await getPresentationConversionFactor(
      page,
      purchasedLine!.productId,
      purchasedLine!.presentationId
    );
    const expectedBaseUnitsAdded = purchasedLine!.quantity * conversionFactor;
    const stockAfter = await getProductStock(page, candidate!.productId);

    console.log(
      `[purchase-stock-effect-presentation-factor] product=${candidate!.productName} ` +
        `presentation=${candidate!.presentationName} (#${candidate!.presentationId}) ` +
        `stockBefore=${stockBefore} quantity=${purchasedLine!.quantity} factor=${conversionFactor} ` +
        `expectedBaseUnitsAdded=${expectedBaseUnitsAdded} stockAfter=${stockAfter}`
    );

    expect(
      conversionFactor,
      'This test only proves something when the factor is > 1.'
    ).toBeGreaterThan(1);
    expect(
      stockAfter,
      `Stock should grow by ${expectedBaseUnitsAdded} base units after the purchase. ` +
        `Before: ${stockBefore}, after: ${stockAfter}.`
    ).toBeCloseTo(stockBefore + expectedBaseUnitsAdded, 5);
  });
});
