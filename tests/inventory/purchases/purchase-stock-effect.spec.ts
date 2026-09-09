/**
 * Purchases counterpart to pos-sale-stock-effect.spec.ts — proves a purchase receipt actually
 * INCREASES product stock, at the base presentation (factor 1). Skips itself when the tenant has
 * no active supplier + product pair whose product only has a single (base) presentation, since
 * picking an ambiguous multi-presentation product would make the "factor 1" assertion meaningless.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../../support/flows/auth.flow';
import {
  getPresentationConversionFactor,
  getProductStock,
} from '../../../support/flows/sales.flow';
import {
  createPurchaseViaInlineSearch,
  findPurchasablePairWithSinglePresentation,
} from '../../../support/flows/purchases.flow';

test.setTimeout(60_000);

test.describe('@regression @purchases @inventory', () => {
  test('@regression @purchases @inventory a purchase increases stock in base units', async ({
    page,
  }) => {
    requireCredentialsOrSkip('purchase stock effect flow');

    const pair = await findPurchasablePairWithSinglePresentation(page);
    test.skip(
      !pair,
      'No active supplier + single-presentation product pair available in the test tenant.'
    );

    const stockBefore = await getProductStock(page, pair!.productId);
    const receipt = await createPurchaseViaInlineSearch(page, pair!);

    const purchasedLine = receipt.lines?.find((line) => line.productId === pair!.productId);
    expect(
      purchasedLine,
      `Purchase #${receipt.id} has no line for product #${pair!.productId}`
    ).toBeTruthy();

    const conversionFactor = await getPresentationConversionFactor(
      page,
      purchasedLine!.productId,
      purchasedLine!.presentationId
    );
    const expectedBaseUnitsAdded = purchasedLine!.quantity * conversionFactor;
    const stockAfter = await getProductStock(page, pair!.productId);

    console.log(
      `[purchase-stock-effect] product=${pair!.productName} (#${pair!.productId}) ` +
        `stockBefore=${stockBefore} quantity=${purchasedLine!.quantity} factor=${conversionFactor} ` +
        `expectedBaseUnitsAdded=${expectedBaseUnitsAdded} stockAfter=${stockAfter}`
    );

    expect(conversionFactor, 'This test only proves the factor-1 case.').toBe(1);
    expect(
      stockAfter,
      `Stock should grow by ${expectedBaseUnitsAdded} base units after the purchase. ` +
        `Before: ${stockBefore}, after: ${stockAfter}.`
    ).toBeCloseTo(stockBefore + expectedBaseUnitsAdded, 5);
  });
});
