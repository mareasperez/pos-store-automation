/**
 * Non-linear counterpart to credit-sale-and-collection.spec.ts: just proves a credit sale can be
 * created end to end (POST /api/sales returns 201) — no before/after balance math, no chained
 * collection payment. Because nothing exact is asserted about the customer's balance, this is
 * safe to run in the default parallel suite even if it shares a customer with other specs.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { getFirstSellableProduct } from '../../support/flows/sales.flow';
import {
  findOrCreateCreditCustomer,
  makeCreditSale,
  openShiftIfPrompted,
  selectPosCustomer,
} from '../../support/flows/creditSales.flow';

test.setTimeout(60_000);

test.describe('@regression @customers @credit-sale', () => {
  test('@regression @customers @credit-sale a credit sale is created successfully', async ({
    page,
  }) => {
    requireCredentialsOrSkip('credit sale creation flow');

    const customer = await findOrCreateCreditCustomer(page);

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    await openShiftIfPrompted(page);

    await selectPosCustomer(page, customer.name);
    const saleTotal = await makeCreditSale(page, productName!);

    expect(saleTotal, 'Credit sale should have a positive total.').toBeGreaterThan(0);
  });
});
