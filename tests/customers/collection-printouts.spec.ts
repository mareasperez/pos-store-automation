/**
 * Collection printouts: customer account statement and collection payment receipt.
 * `window.print` is stubbed, so the native dialog never opens; assertions read the print-service
 * portal (`[data-print-job-type]`), which stays mounted until `afterprint` is dispatched.
 *
 * - Statement printing and receipt reprint are read-only and run in the parallel suite.
 * - Printing the receipt after registering a collection changes a customer balance, so it runs
 *   with the @receivables-serial group (`npm run test:serial:*`, --workers=1), like
 *   credit-sale-and-collection.spec.ts.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, parallelDescribe, serialDescribe, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  amountDigits,
  digitsOnly,
  expectPrintJob,
  finishPrintJob,
  stubWindowPrint,
} from '../../support/flows/printing.flow';
import {
  findExistingDebtor,
  getReceivableBalance,
  listCustomerCollections,
  openNewCollectionForCustomer,
  registerCollectionPayment,
} from '../../support/flows/receivables.flow';

test.setTimeout(90_000);

/**
 * Other parallel specs may pay the same debtor meanwhile, so accept the balance read before or
 * after printing rather than racing on an exact snapshot.
 */
async function expectStatementTotal(
  page: Page,
  statement: Locator,
  customerId: number,
  balanceBefore: number
): Promise<void> {
  const printed = digitsOnly(await statement.getByTestId('customer-statement-total').textContent());
  const balanceAfter = await getReceivableBalance(page, customerId);
  expect([amountDigits(balanceBefore), amountDigits(balanceAfter)]).toContain(printed);
}

parallelDescribe('@regression @customers @customer-collections @printing', () => {
  test('@regression @customers @printing prints the customer statement from the debt detail dialog', async ({
    page,
  }) => {
    requireCredentialsOrSkip('customer statement print');
    await stubWindowPrint(page);

    const debtor = await findExistingDebtor(page);
    test.skip(!debtor, 'No customer with an outstanding balance in the test tenant.');
    const balance = await getReceivableBalance(page, debtor!.customerId);

    await page.goto('/customer-debt?lng=es', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('customer-debt-search').fill(debtor!.customerName!);
    const row = page.getByTestId(`customer-debt-row-${debtor!.customerId}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    await page.getByTestId('customer-debt-print-statement').click();

    const statement = await expectPrintJob(page, 'customer-statement');
    await expect(statement).toContainText('Estado de cuenta');
    await expect(statement).toContainText(debtor!.customerName!);
    await expectStatementTotal(page, statement, debtor!.customerId, balance);

    await finishPrintJob(page);
  });

  test('@regression @customers @printing prints the customer statement from the new collection dialog', async ({
    page,
  }) => {
    requireCredentialsOrSkip('customer statement print');
    await stubWindowPrint(page);

    const debtor = await findExistingDebtor(page);
    test.skip(!debtor, 'No customer with an outstanding balance in the test tenant.');
    const balance = await getReceivableBalance(page, debtor!.customerId);

    await openNewCollectionForCustomer(page, debtor!.customerName!);
    await page.getByTestId('collection-print-statement').click();

    const statement = await expectPrintJob(page, 'customer-statement');
    await expect(statement).toContainText('Estado de cuenta');
    await expect(statement).toContainText(debtor!.customerName!);
    await expectStatementTotal(page, statement, debtor!.customerId, balance);

    await finishPrintJob(page);
  });

  test('@regression @customers @printing reprints a collection receipt from the details dialog', async ({
    page,
  }) => {
    requireCredentialsOrSkip('collection receipt reprint');
    await stubWindowPrint(page);

    const collection = (await listCustomerCollections(page)).find((row) => row.receiptNumber);
    test.skip(!collection, 'No customer collection in the test tenant.');

    await page.goto('/customer-collections?lng=es', { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`customer-collection-view-${collection!.id}`).click();
    await page.getByTestId('collection-details-print').click();

    const receipt = await expectPrintJob(page, 'collection-receipt');
    await expect(receipt).toContainText('Comprobante de pago');
    await expect(receipt).toContainText(collection!.receiptNumber);

    await finishPrintJob(page);
  });
});

serialDescribe('@real @manual @receivables-serial', () => {
  test('@serial @real @manual @receivables-serial @printing prints the receipt from the toast after registering a collection', async ({
    page,
  }) => {
    requireCredentialsOrSkip('collection receipt print');
    await stubWindowPrint(page);

    const debtor = await findExistingDebtor(page);
    test.skip(!debtor, 'No customer with an outstanding balance in the test tenant.');
    const balance = await getReceivableBalance(page, debtor!.customerId);
    const paymentAmount = Math.max(0.01, Math.min(1, Math.round((balance / 2) * 100) / 100));

    const created = await registerCollectionPayment(page, debtor!.customerName!, paymentAmount);

    await page.getByRole('button', { name: 'Imprimir comprobante' }).click();

    const receipt = await expectPrintJob(page, 'collection-receipt');
    await expect(receipt).toContainText('Comprobante de pago');
    await expect(receipt).toContainText(created.receiptNumber);
    await expect(receipt).toContainText(debtor!.customerName!);
    await expect(receipt).toContainText('Atendido por');

    await finishPrintJob(page);
  });
});
