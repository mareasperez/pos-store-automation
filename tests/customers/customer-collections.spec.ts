/**
 * Focused coverage for registering a customer-collection payment against an EXISTING debtor —
 * doesn't create a fresh credit sale first (see credit-sale-and-collection.spec.ts for that
 * end-to-end flow, which needs --workers=1 serial isolation for its exact balance-delta math
 * across a sale + a payment). This one only checks that a payment actually reduces the
 * customer's balance, so it's safe to run in the default parallel suite — as long as it isn't
 * run alongside credit-sale-and-collection.spec.ts against the same tenant at the same time.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  findExistingDebtor,
  getReceivableBalance,
  registerCollectionPayment,
} from '../../support/flows/receivables.flow';

test.setTimeout(60_000);

test.describe('@regression @customers @customer-collections', () => {
  test('@regression @customers @customer-collections registering a payment reduces the customer balance', async ({
    page,
  }) => {
    requireCredentialsOrSkip('customer collection payment flow');

    const debtor = await findExistingDebtor(page);
    test.skip(!debtor, 'No customer with an outstanding balance in the test tenant.');

    const balanceBefore = await getReceivableBalance(page, debtor!.customerId);

    // Pay half the debt so this always fits within the customer's actual balance.
    const paymentAmount = Math.round((balanceBefore / 2) * 100) / 100;
    console.log(
      `[customer-collections] customer=${debtor!.customerName} (#${debtor!.customerId}) ` +
        `balanceBefore=${balanceBefore} paymentAmount=${paymentAmount}`
    );
    await registerCollectionPayment(page, debtor!.customerName!, paymentAmount);

    const balanceAfter = await getReceivableBalance(page, debtor!.customerId);
    const expectedBalanceAfter = balanceBefore - paymentAmount;
    console.log(
      `[customer-collections] balanceAfter=${balanceAfter} expectedBalanceAfter=${expectedBalanceAfter} ` +
        `match=${Math.abs(balanceAfter - expectedBalanceAfter) < 0.05}`
    );
    expect(
      balanceAfter,
      `Balance should shrink by the payment (${paymentAmount}). ` +
        `Before: ${balanceBefore}, after: ${balanceAfter}.`
    ).toBeCloseTo(expectedBalanceAfter, 1);
  });
});
