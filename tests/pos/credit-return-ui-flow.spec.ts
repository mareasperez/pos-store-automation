/**
 * Real UI flow: credit sale -> APPLY_TO_RECEIVABLE return.
 *
 * The test is serial because it asserts exact deltas in both customer receivables and the active
 * shift. A credit return must reduce debt and restore stock without changing cash expectations.
 */
import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  findOrCreateCreditCustomer,
  makeCreditSaleWithDetails,
  openShiftIfPrompted,
  selectPosCustomer,
} from '../../support/flows/creditSales.flow';
import { getReceivableBalance } from '../../support/flows/receivables.flow';
import {
  getActiveShiftWithExpectations,
  getExpectedAmount,
  getExpectedBaseUnitReturns,
  getFirstActiveCashPaymentMethodId,
  getFirstWarehouseId,
  getReturnSaleDetail,
  type ReturnDTO,
} from '../../support/flows/returns.flow';
import { getFirstSellableProduct, getProductStock } from '../../support/flows/sales.flow';

test.setTimeout(120_000);

test.describe('@regression @pos @returns @shift-serial @receivables-serial', () => {
  test('applies a credit sale return only to the receivable without changing cash', async ({
    page,
  }) => {
    requireCredentialsOrSkip('credit return UI flow');

    const customer = await findOrCreateCreditCustomer(page);
    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    const warehouseId = await getFirstWarehouseId(page);
    test.skip(!warehouseId, 'No warehouse available in the test tenant.');

    const cashPaymentMethodId = await getFirstActiveCashPaymentMethodId(page);
    test.skip(!cashPaymentMethodId, 'No active CASH payment method in the test tenant.');

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    await openShiftIfPrompted(page);

    const balanceBeforeSale = await getReceivableBalance(page, customer.id);
    await selectPosCustomer(page, customer.name);
    const createdSale = await makeCreditSaleWithDetails(page, productName!);

    const balanceBeforeReturn = await getReceivableBalance(page, customer.id);
    expect(balanceBeforeReturn).toBeCloseTo(balanceBeforeSale + createdSale.total, 1);

    const sale = await getReturnSaleDetail(page, createdSale.id);
    expect(sale.status).toBe('COMPLETED');
    expect(sale.paymentTerm).toBe('CREDIT');

    const expectedBaseUnitsByProduct = await getExpectedBaseUnitReturns(page, sale.lines);
    const stockBeforeReturn = new Map<number, number>();
    for (const productId of expectedBaseUnitsByProduct.keys()) {
      stockBeforeReturn.set(productId, await getProductStock(page, productId));
    }

    const shiftBeforeReturn = await getActiveShiftWithExpectations(page);
    expect(shiftBeforeReturn, 'No active shift found after creating the credit sale.').toBeTruthy();
    const cashExpectedBeforeReturn = getExpectedAmount(
      shiftBeforeReturn!,
      cashPaymentMethodId!
    );

    await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('customer-return-open-create').click();

    await page.getByTestId('customer-return-customer-search').click();
    await page.getByRole('listbox').waitFor({ state: 'visible' });
    await page
      .getByRole('option', { name: new RegExp(customer.name.substring(0, 15), 'i') })
      .first()
      .click();

    await page.getByTestId('customer-return-sale-search').click();
    await page.getByRole('listbox').waitFor({ state: 'visible' });
    await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();
    await page
      .getByTestId('customer-return-warehouse-select')
      .selectOption({ value: String(warehouseId) });
    await page.getByTestId('customer-return-continue').click();

    const refundMethodSelect = page.getByTestId('customer-return-refund-method-select');
    await expect(refundMethodSelect).toHaveValue('APPLY_TO_RECEIVABLE');
    await expect(refundMethodSelect.locator('option')).toHaveCount(1);
    await expect(
      page.getByTestId('customer-return-refund-payment-method-select')
    ).toHaveCount(0);

    await page.getByTestId('customer-return-select-all').click();

    const returnResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/returns') && response.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.getByTestId('customer-return-submit').click();
    const returnResponse = await returnResponsePromise;
    expect(returnResponse.status(), await returnResponse.text()).toBe(200);

    const requestBody = returnResponse.request().postDataJSON() as {
      refundMethod: string;
      paymentMethodId: number | null;
    };
    expect(requestBody.refundMethod).toBe('APPLY_TO_RECEIVABLE');
    expect(requestBody.paymentMethodId).toBeNull();

    const returnDto = (await returnResponse.json()) as ReturnDTO;
    expect(returnDto.saleId).toBe(sale.id);
    expect(returnDto.status).toBe('POSTED');
    expect(returnDto.refundMethod).toBe('APPLY_TO_RECEIVABLE');
    expect(returnDto.refundPaymentMethodId).toBeNull();
    expect(returnDto.financialMovementId).not.toBeNull();
    expect(returnDto.itemCount).toBe(sale.lines.length);
    expect(returnDto.totalRefunded).toBeCloseTo(sale.total, 2);

    const balanceAfterReturn = await getReceivableBalance(page, customer.id);
    expect(balanceAfterReturn).toBeCloseTo(
      balanceBeforeReturn - Number(returnDto.totalRefunded),
      1
    );

    const shiftAfterReturn = await getActiveShiftWithExpectations(page);
    expect(shiftAfterReturn, 'Shift closed unexpectedly after the credit return.').toBeTruthy();
    expect(getExpectedAmount(shiftAfterReturn!, cashPaymentMethodId!)).toBeCloseTo(
      cashExpectedBeforeReturn,
      2
    );

    for (const [productId, expectedDelta] of expectedBaseUnitsByProduct) {
      const stockAfterReturn = await getProductStock(page, productId);
      expect(stockAfterReturn - (stockBeforeReturn.get(productId) ?? 0)).toBeCloseTo(
        expectedDelta,
        2
      );
    }
  });
});