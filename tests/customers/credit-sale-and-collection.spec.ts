/**
 * Cross-module e2e: credit sale -> customer collection payment -> receivable balance validation.
 * Tag: @real @manual @receivables-serial — a customer's receivable balance is tenant-wide
 * shared state (like stock/sequences), but unlike stock lookups this test can't route around
 * contention by trying another candidate: it reads the balance before/after each action and
 * asserts an exact delta, so a concurrent worker touching the same customer would make it flaky.
 * Excluded from the default parallel suite the same way @shift-serial is (see
 * playwright.config.ts) and only runs via `npm run test:serial:*` with --workers=1.
 *
 * Flow: find an existing credit-enabled customer (or create one) -> sell to them on credit with
 * no initial payment -> assert the server's receivable balance grew by the sale total -> register
 * a partial payment via Customer Collections (FIFO) -> assert the balance shrank by that payment.
 *
 * Run: npm run test:serial:local (or test:serial:dev)
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { getFirstSellableProduct } from '../../support/flows/sales.flow';
import { getReceivableBalance, registerCollectionPayment } from '../../support/flows/receivables.flow';
import {
  findOrCreateCreditCustomer,
  makeCreditSale,
  openShiftIfPrompted,
  selectPosCustomer,
} from '../../support/flows/creditSales.flow';

test.setTimeout(120_000);

test.describe('@real @manual @receivables-serial', () => {
  test('@real @manual @receivables-serial credit sale then a partial collection reduces the customer balance', async ({
    page,
  }) => {
    requireCredentialsOrSkip('credit sale + collection flow');

    const customer = await findOrCreateCreditCustomer(page);

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    await openShiftIfPrompted(page);

    const balanceBeforeSale = await getReceivableBalance(page, customer.id);

    await selectPosCustomer(page, customer.name);
    const saleTotal = await makeCreditSale(page, productName!);

    const balanceAfterSale = await getReceivableBalance(page, customer.id);
    expect(
      balanceAfterSale,
      `Balance should grow by the sale total (${saleTotal}). ` +
        `Before: ${balanceBeforeSale}, after: ${balanceAfterSale}.`
    ).toBeCloseTo(balanceBeforeSale + saleTotal, 1);

    // Pay half the sale so the balance check exercises a real partial payment, not just a full clear.
    const paymentAmount = Math.round((saleTotal / 2) * 100) / 100;
    await registerCollectionPayment(page, customer.name, paymentAmount);

    const balanceAfterPayment = await getReceivableBalance(page, customer.id);
    expect(
      balanceAfterPayment,
      `Balance should shrink by the payment (${paymentAmount}). ` +
        `Before payment: ${balanceAfterSale}, after: ${balanceAfterPayment}.`
    ).toBeCloseTo(balanceAfterSale - paymentAmount, 1);
  });
});
