import { expect, expectHttpError, test } from '@fixtures';
import {
  addFractional,
  api,
  cashCents,
  discount,
  fractionalPreflight,
  openFractionalPos,
  payFractional,
  quantityEditor,
  rawRequest,
  responseFor,
  returnFractional,
  seedFractional,
  setQuantity,
  shiftLedger,
  stockIs,
  type FractionalFixture,
  type FractionalSale,
  type FinancialEntry,
  type ShiftLedger,
} from '../../support/flows/fractional.flow';
import { addExactItem, openQuoteUi } from '../../support/flows/combos.flow';
import type { CommercialDocument } from '../../support/flows/combos.flow';
import type { Page } from '@playwright/test';

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 960 } });

test.beforeEach(async ({ page }) => fractionalPreflight(page));

test('@serial @configured-target @fractional C1 precision, shortage, owned draft reload and exact deduction', async ({
  page,
}) => {
  const fixture = await seedFractional(page, [20], 0.6);
  const item = fixture.items[0];
  await openFractionalPos(page, fixture);
  await addExactItem(page, item.name);
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeDisabled();
  const quantity = await quantityEditor(page, item);
  await quantity.fill('0.50001');
  await quantity.press('Enter');
  await expect(quantity).toBeVisible();
  await expect(quantity).toHaveAttribute('aria-invalid', 'true');
  await quantity.fill('0.7');
  await quantity.press('Enter');
  await expect(quantity).toBeHidden();
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeDisabled();
  await stockIs(page, fixture, item, 0.6);
  const ledgerBeforeZero = await shiftLedger(page);
  expectHttpError(400, '/sales');
  // API-only negative guard; all successful lifecycle mutations below use the browser.
  const zeroLine = await rawRequest(page, '/sales', {
    customerId: fixture.customer.id,
    warehouseId: fixture.warehouse.id,
    paymentTerm: 'IMMEDIATE',
    payments: [{ paymentMethodId: fixture.cash.id, amount: 0.01, tenderedAmount: 0.01 }],
    lines: [
      {
        sellableType: 'PRODUCT',
        productId: item.id,
        presentationId: item.presentation.id,
        quantity: 0.0001,
        discount: 0,
      },
    ],
  });
  expect(zeroLine.status(), await zeroLine.text()).toBe(400);
  expect(await zeroLine.json()).toMatchObject({
    code: 'DOMAIN_ERROR',
    message: expect.stringContaining('mayor que cero'),
  });
  await stockIs(page, fixture, item, 0.6);
  expect(await shiftLedger(page)).toEqual(ledgerBeforeZero);
  expect(
    (await api<{ totalElements: number }>(page, `/sales?customerId=${fixture.customer.id}&size=1`))
      .totalElements
  ).toBe(0);
  await setQuantity(page, item, '0.5');
  await expect(page.getByTestId('pos-cart-total')).toContainText('10.00');
  await page.getByRole('button', { name: 'Guardar en espera', exact: true }).click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('pos-product-search').fill(item.name);
  await expect(page.getByRole('option').filter({ hasText: item.name })).toBeVisible();
  await page.getByTestId('pos-product-search').fill('');
  await page.getByRole('button', { name: 'Retomar', exact: true }).click();
  await expect(
    page.getByTestId('ticket-line').getByRole('button', { name: /^Editar la cantidad de/ })
  ).toHaveText('0.5');
  const sale = await payFractional(page, fixture, '10.00');
  expect(Number(sale.lines[0].quantity)).toBe(0.5);
  expect(Number(sale.lines[0].subtotal)).toBe(10);
  await stockIs(page, fixture, item, 0.1);
});

for (const example of [
  {
    name: '2-line W17A',
    prices: [85.5, 85.5],
    quantity: '0.972',
    cents: [8311, 8311],
    total: '166.22',
    tendered: '200.00',
    stock: 9.028,
  },
  {
    name: '4-line W17A',
    prices: [85.5, 85.5, 85.5, 85.5],
    quantity: '0.972',
    cents: [8311, 8311, 8311, 8311],
    total: '332.44',
    tendered: '400.00',
    stock: 9.028,
  },
  {
    name: '2-line half-cent boundaries',
    prices: [0.01, 0.03],
    quantity: '0.5',
    cents: [1, 2],
    total: '0.03',
    tendered: '1.00',
    stock: 9.5,
  },
]) {
  test(`@serial @configured-target @fractional C2 ${example.name}, cash/change and stock`, async ({
    page,
  }) => {
    const fixture = await seedFractional(page, example.prices);
    const before = await shiftLedger(page);
    await openFractionalPos(page, fixture);
    for (const item of fixture.items) await addFractional(page, item, example.quantity);
    const sale = await payFractional(page, fixture, example.total, example.tendered);
    expect(sale.lines.map((line) => Math.round(Number(line.subtotal) * 100))).toEqual(
      example.cents
    );
    expect(sale.payments).toHaveLength(1);
    expect(Number(sale.payments[0].amount)).toBe(Number(example.total));
    expect(Number(sale.payments[0].tenderedAmount)).toBe(Number(example.tendered));
    const after = await shiftLedger(page);
    expect(cashCents(after, fixture) - cashCents(before, fixture)).toBe(
      example.cents.reduce((sum, cents) => sum + cents, 0)
    );
    expect(after.cashMovements).toEqual(before.cashMovements);
    expect(after.salesPayments.filter((entry) => entry.saleId === sale.id)).toEqual([
      expect.objectContaining({ amount: Number(example.total) }),
    ]);
    for (const item of fixture.items) await stockIs(page, fixture, item, example.stock);
  });
}

test('@serial @configured-target @fractional C3 UI quote edit, frozen price, disabled conversion and linkage', async ({
  page,
}) => {
  const fixture = await seedFractional(page, [85.5]);
  const item = fixture.items[0];
  const before = await shiftLedger(page);
  await page.goto('/quotes?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quotes-new').click();
  const customer = page.getByTestId('quote-form-customer');
  await expect(customer).not.toHaveAttribute('data-disabled');
  await customer.fill(fixture.customer.name);
  await page.getByRole('option', { name: fixture.customer.name, exact: true }).click();
  await page.getByTestId('quote-form-warehouse').click();
  await page.getByRole('option', { name: fixture.warehouse.name, exact: true }).click();
  await page.getByTestId('quote-add-item').click();
  await page.getByTestId('product-search-modal-input').fill(item.name);
  await page.getByTestId(`product-card-${item.id}-${item.presentation.id}`).click();
  await page.getByTestId('quote-line-quantity').fill('0.9725');
  const createdResponse = responseFor(page, 'POST', '/quotes');
  await page.getByTestId('quote-form-save').click();
  const created = await createdResponse;
  expect(created.status(), await created.text()).toBe(201);
  let quote = (await created.json()) as CommercialDocument;
  console.log(`${fixture.prefix}: UI quote ${quote.id}`);
  expect(Number(quote.total)).toBe(83.15);
  await openQuoteUi(page, quote);
  await page.getByTestId('quote-detail-edit').click();
  await expect(page.getByTestId('quote-form-save')).toBeEnabled();
  await page.getByTestId('quote-line-quantity').fill('0.972');
  await expect(page.getByTestId('quote-form-totals')).toContainText('83.11');
  const editedResponse = responseFor(page, 'PUT', `/quotes/${quote.id}`);
  await page.getByTestId('quote-form-save').click();
  const edited = await editedResponse;
  expect(edited.status(), await edited.text()).toBe(200);
  expect(edited.request().postDataJSON()).toMatchObject({ lines: [{ quantity: 0.972 }] });
  quote = (await edited.json()) as CommercialDocument;
  expect(Number(quote.total)).toBe(83.11);
  expect(Number(quote.lines[0].quantity)).toBe(0.972);
  await api(page, `/product-presentations/${item.presentation.id}`, 'PUT', {
    ...item.presentation,
    price: 99,
    allowsFractionalQuantity: false,
  });
  await openQuoteUi(page, quote);
  await expect(page.getByTestId('quote-detail-sell')).toBeVisible();
  const historical = await api<CommercialDocument>(page, `/quotes/${quote.id}`);
  expect(Number(historical.lines[0].unitPrice)).toBe(85.5);
  expect(Number(historical.total)).toBe(83.11);
  let salePosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sales')
      salePosts += 1;
  });
  await page.getByTestId('quote-detail-sell').click();
  await expect(page.getByTestId('pos-quote-fractional-block')).toContainText(item.name);
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeDisabled();
  expect(salePosts).toBe(0);
  const rejected = await api<CommercialDocument>(page, `/quotes/${quote.id}`);
  expect(rejected.status).toBe('OPEN');
  expect(rejected.saleId).toBeNull();
  expect(
    (await api<{ totalElements: number }>(page, `/sales?customerId=${fixture.customer.id}&size=1`))
      .totalElements
  ).toBe(0);
  await stockIs(page, fixture, item, 10);
  const unchanged = await shiftLedger(page);
  expect(unchanged.salesPayments).toEqual(before.salesPayments);
  expect(unchanged.cashMovements).toEqual(before.cashMovements);
  expect(cashCents(unchanged, fixture)).toBe(cashCents(before, fixture));
  await api(page, `/product-presentations/${item.presentation.id}`, 'PUT', {
    ...item.presentation,
    price: 99,
    allowsFractionalQuantity: true,
  });
  await openQuoteUi(page, quote);
  await page.getByTestId('quote-detail-sell').click();
  await expect(page.getByTestId('pos-quote-panel')).toBeVisible();
  const sale = await payFractional(page, fixture, '83.11', '83.11', quote.id);
  expect(Number(sale.lines[0].quantity)).toBe(0.972);
  expect(Number(sale.lines[0].subtotal)).toBe(83.11);
  expect(Number(sale.lines[0].presentationPrice)).toBe(85.5);
  const linked = await api<CommercialDocument>(page, `/quotes/${quote.id}`);
  expect(linked.status).toBe('SOLD');
  expect(linked.saleId).toBe(sale.id);
  expect(Number(linked.total)).toBe(83.11);
  await stockIs(page, fixture, item, 9.028);
});

async function financials(page: Page, fixture: FractionalFixture) {
  return api<FinancialEntry[]>(
    page,
    `/financial-movements?partyType=CUSTOMER&partyId=${fixture.customer.id}`
  );
}

function assertRefundMovements(
  before: ShiftLedger,
  after: ShiftLedger,
  financialBefore: FinancialEntry[],
  financialAfter: FinancialEntry[],
  refund: { returnId: number; saleId: number; amount: number; paymentMethodId: number }
): void {
  const addedCash = after.cashMovements.filter(
    (entry) => !before.cashMovements.some((previous) => previous.id === entry.id)
  );
  const addedFinancial = financialAfter.filter(
    (entry) => !financialBefore.some((previous) => previous.id === entry.id)
  );
  const expectedCash =
    refund.amount === 0
      ? []
      : [
          expect.objectContaining({
            type: 'OUT',
            returnId: refund.returnId,
            paymentMethodId: refund.paymentMethodId,
            amount: refund.amount,
            currency: 'NIO',
            reason: `Customer return #${refund.returnId} for sale #${refund.saleId}`,
          }),
        ];
  expect(addedCash).toEqual(expectedCash);
  // CASH refunds use linked shift OUT entries, not the derived receivable ledger trace.
  expect(addedFinancial).toHaveLength(0);
  expect(financialAfter).toEqual(financialBefore);
  expect(
    after.cashMovements.filter((entry) =>
      before.cashMovements.some((previous) => previous.id === entry.id)
    )
  ).toEqual(before.cashMovements);
}

async function voidUi(page: Page, sale: FractionalSale): Promise<void> {
  await page.goto('/sales-history?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sales-history-search').fill(sale.saleNumber);
  await page.getByTestId(`sale-actions-${sale.id}`).click();
  await page.getByTestId(`sale-void-${sale.id}`).click();
  const response = responseFor(page, 'POST', `/sales/${sale.id}/void`);
  await page.getByTestId('void-sale-confirm').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
}

test('@serial @configured-target @fractional C4 discounted cumulative returns use sale-time factor and block void', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const fixture = await seedFractional(page, [8, 10], 10, 2);
  const item = fixture.items[0];
  const before = await shiftLedger(page);
  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.75');
  await addFractional(page, fixture.items[1], '0.5');
  await discount(page, '1.00', fixture.prefix);
  const sale = await payFractional(page, fixture, '10.00');
  const originalReceipt = await financials(page, fixture);
  expect(originalReceipt).toEqual([
    expect.objectContaining({
      sourceId: sale.id,
      status: 'POSTED',
      direction: 'INBOUND',
      amount: 10,
    }),
  ]);
  expect(Number(sale.preManualTotal)).toBe(11);
  expect(
    sale.lines.map((line) => [
      Number(line.preManualSubtotal),
      Number(line.manualDiscountAmount),
      Number(line.subtotal),
    ])
  ).toEqual([
    [6, 0.55, 5.45],
    [5, 0.45, 4.55],
  ]);
  expect(sale.lines[0].fractionalQuantityAllowed).toBe(true);
  expect(Number(sale.lines[0].conversionFactorSnapshot)).toBe(2);
  await stockIs(page, fixture, item, 8.5);
  await stockIs(page, fixture, fixture.items[1], 9);
  await api(page, `/product-presentations/${item.presentation.id}`, 'PUT', {
    ...item.presentation,
    conversionFactor: 3,
    allowsFractionalQuantity: false,
  });
  expect((await api<FractionalSale>(page, `/sales/${sale.id}`)).lines[0]).toMatchObject({
    quantity: 0.75,
    fractionalQuantityAllowed: true,
    conversionFactorSnapshot: 2,
    subtotal: 5.45,
    manualDiscountAmount: 0.55,
  });
  let totalRefundCents = 0;
  for (const [
    quantity,
    refund,
    stock,
    returnedBefore,
    remainingBefore,
    cumulative,
    remainingAfter,
  ] of [
    [0.0001, 0, 8.5002, 0, 0.75, 0.0001, 0.7499],
    [0.2499, 1.82, 9, 0.0001, 0.7499, 0.25, 0.5],
    [0.25, 1.81, 9.5, 0.25, 0.5, 0.5, 0.25],
    [0.25, 1.82, 10, 0.5, 0.25, 0.75, 0],
  ]) {
    const previous = await shiftLedger(page);
    const previousFinancials = await financials(page, fixture);
    const returned = await returnFractional(page, fixture, sale, quantity, {
      returned: returnedBefore,
      remaining: remainingBefore,
    });
    expect(Number(returned.totalRefunded)).toBe(refund);
    expect(returned.financialMovementId).toBeNull();
    totalRefundCents += Math.round(Number(returned.totalRefunded) * 100);
    const after = await shiftLedger(page);
    expect(cashCents(previous, fixture) - cashCents(after, fixture)).toBe(Math.round(refund * 100));
    await stockIs(page, fixture, item, stock);
    const movements = await financials(page, fixture);
    assertRefundMovements(previous, after, previousFinancials, movements, {
      returnId: returned.id,
      saleId: sale.id,
      amount: refund,
      paymentMethodId: fixture.cash.id,
    });
    const remaining = await api<
      { saleLineId: number; returnedQuantity: number; remainingQuantity: number }[]
    >(page, `/returns/sales/${sale.id}/remaining-quantities`);
    expect(remaining).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          saleLineId: sale.lines[0].id,
          returnedQuantity: cumulative,
          remainingQuantity: remainingAfter,
        }),
      ])
    );
  }
  const finalLedger = await shiftLedger(page);
  const finalFinancials = await financials(page, fixture);
  expect(finalFinancials).toEqual(originalReceipt);
  expect(totalRefundCents).toBe(545);
  expect(cashCents(finalLedger, fixture) - cashCents(before, fixture)).toBe(455);
  expectHttpError(400, '/returns');
  const excess = await rawRequest(page, '/returns', {
    saleId: sale.id,
    warehouseId: fixture.warehouse.id,
    reasonType: 'CUSTOMER_REGRET',
    refundMethod: 'CASH',
    paymentMethodId: fixture.cash.id,
    items: [
      {
        saleLineId: sale.lines[0].id,
        productId: item.id,
        presentationId: item.presentation.id,
        quantity: 0.0001,
      },
    ],
  });
  expect(excess.status(), await excess.text()).toBe(400);
  expect((await excess.json()) as unknown).toEqual(
    expect.objectContaining({ message: expect.stringMatching(/remaining quantity/i) })
  );
  expectHttpError(400, `/sales/${sale.id}/void`);
  const voided = await rawRequest(page, `/sales/${sale.id}/void`, {});
  expect(voided.status(), await voided.text()).toBe(400);
  expect((await voided.json()) as unknown).toEqual(
    expect.objectContaining({ message: expect.stringMatching(/return/i) })
  );
  expect(await shiftLedger(page)).toEqual(finalLedger);
  expect(await financials(page, fixture)).toEqual(finalFinancials);
  await stockIs(page, fixture, item, 10);
  expect((await api<FractionalSale>(page, `/sales/${sale.id}`)).status).toBe('COMPLETED');
});

test('@serial @configured-target @fractional C5 separate discounted sale UI void reverses exactly once', async ({
  page,
}) => {
  const fixture = await seedFractional(page, [23], 10, 1, 0.15);
  const item = fixture.items[0];
  const before = await shiftLedger(page);
  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.5');
  await discount(page, '0.50', fixture.prefix);
  const sale = await payFractional(page, fixture, '11.00');
  expect(Number(sale.preManualTotal)).toBe(11.5);
  expect(Number(sale.manualDiscountAmount)).toBe(0.5);
  expect(Number(sale.tax)).toBe(1.43);
  expect(Number(sale.subtotal)).toBe(9.57);
  expect(Number(sale.lines[0].preManualSubtotal)).toBe(11.5);
  expect(Number(sale.lines[0].subtotal)).toBe(11);
  await stockIs(page, fixture, item, 9.5);
  const posted = await shiftLedger(page);
  expect(cashCents(posted, fixture) - cashCents(before, fixture)).toBe(1100);
  expect(posted.cashMovements).toEqual(before.cashMovements);
  expect(posted.salesPayments.filter((entry) => entry.saleId === sale.id)).toEqual([
    expect.objectContaining({ amount: 11 }),
  ]);
  const postedFinancials = await financials(page, fixture);
  expect(postedFinancials).toEqual([
    expect.objectContaining({
      sourceId: sale.id,
      status: 'POSTED',
      direction: 'INBOUND',
      amount: 11,
    }),
  ]);
  await voidUi(page, sale);
  expect((await api<FractionalSale>(page, `/sales/${sale.id}`)).status).toBe('CANCELLED');
  await stockIs(page, fixture, item, 10);
  const reversed = await shiftLedger(page);
  expect(cashCents(reversed, fixture)).toBe(cashCents(before, fixture));
  expect(reversed.cashMovements).toEqual(before.cashMovements);
  expect(reversed.salesPayments.filter((entry) => entry.saleId === sale.id)).toHaveLength(0);
  const reversedFinancials = await financials(page, fixture);
  expect(reversedFinancials).toHaveLength(2);
  const original = reversedFinancials.find((entry) => entry.id === postedFinancials[0].id)!;
  const reversal = reversedFinancials.find((entry) => entry.reversalOfMovementId === original.id)!;
  expect(original).toMatchObject({ status: 'VOIDED', amount: 11, reversalMovementId: reversal.id });
  expect(reversal).toMatchObject({
    status: 'POSTED',
    direction: 'OUTBOUND',
    amount: 11,
    sourceId: sale.id,
  });
  console.log(`${fixture.prefix}: financial ${original.id} reversed once by ${reversal.id}`);
  expectHttpError(400, `/sales/${sale.id}/void`);
  const duplicate = await rawRequest(page, `/sales/${sale.id}/void`, {});
  expect(duplicate.status(), await duplicate.text()).toBe(400);
  expect(await shiftLedger(page)).toEqual(reversed);
  expect(await financials(page, fixture)).toEqual(reversedFinancials);
  await stockIs(page, fixture, item, 10);
});
