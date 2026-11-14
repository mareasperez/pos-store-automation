import { expect, expectHttpError, test } from '@fixtures';
import { config } from '@config';
import { addExactItem, api, responseFor, type Combo } from '../../support/flows/combos.flow';
import {
  addFractional,
  discount,
  fractionalPreflight,
  openFractionalPos,
  payFractional,
  rawRequest,
  seedFractional,
  shiftLedger,
  stockIs,
} from '../../support/flows/fractional.flow';
import {
  createPromotionViaApi,
  deactivatePromotionViaApi,
} from '../../support/flows/promotions.flow';

test.setTimeout(300_000);

test.beforeEach(async ({ page }) => {
  expect(config.tenantId).toBe('651167cc-9f50-4ff1-a8d7-e9f8a68ccce5');
  await fractionalPreflight(page);
});

test('@serial @local @fractional creates and sells a fractional recipe as a whole combo', async ({
  page,
}) => {
  const fixture = await seedFractional(page, [10, 10]);
  const [first, second] = fixture.items;
  await page.goto('/catalog/combos/new?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Nombre', { exact: true }).fill(`${fixture.prefix}-Combo`);
  await page.getByLabel('SKU', { exact: true }).fill(`${fixture.prefix}-Combo`);
  for (const [item, quantity] of [
    [first, '0.3125'],
    [second, '0.25'],
  ] as const) {
    await page.getByRole('button', { name: 'Agregar productos', exact: true }).click();
    await page.getByTestId('product-search-modal-input').fill(item.name);
    await page.getByTestId(`product-card-${item.id}-${item.presentation.id}`).click();
    await expect(page.getByTestId('product-search-modal-input')).toBeHidden();
    await page
      .getByTestId(`combo-component-${item.id}`)
      .getByRole('textbox', { name: /Cantidad/ })
      .fill(quantity);
  }
  await page.locator('#combo-fixed-price').fill('5.63');
  const save = responseFor(page, 'POST', '/combos');
  await page.getByRole('button', { name: /^Guardar combo$/i }).click();
  const response = await save;
  expect(response.status(), await response.text()).toBe(201);
  const combo = (await response.json()) as Combo;
  console.log(`${fixture.prefix}: UI combo ${combo.product.id}`);
  const persisted = await api<Combo>(page, `/combos/${combo.product.id}`);
  expect(
    persisted.components.map((component) => [component.productId, Number(component.quantity)])
  ).toEqual(
    expect.arrayContaining([
      [first.id, 0.3125],
      [second.id, 0.25],
    ])
  );
  expect(
    persisted.components.reduce(
      (cents, component) =>
        cents + Math.round(Number(component.allocatedSalePrice) * Number(component.quantity) * 100),
      0
    )
  ).toBe(563);
  await page.goto(`/catalog/combos/${combo.product.id}/edit?lng=es`, {
    waitUntil: 'domcontentloaded',
  });
  for (const [item, quantity] of [
    [first, '0.3125'],
    [second, '0.25'],
  ] as const) {
    await expect(
      page.getByTestId(`combo-component-${item.id}`).getByRole('textbox', { name: /Cantidad/ })
    ).toHaveValue(quantity);
  }
  const reopened = await api<Combo>(page, `/combos/${combo.product.id}`);
  expect(reopened.components).toEqual(persisted.components);

  const before = await shiftLedger(page);
  const presentations = await api<{ id: number; isBasePresentation: boolean }[]>(
    page,
    `/product-presentations?productId=${combo.product.id}`
  );
  const comboPresentation = presentations.find((entry) => entry.isBasePresentation);
  expect(comboPresentation).toBeTruthy();
  expectHttpError(400, '/sales');
  const invalid = await rawRequest(page, '/sales', {
    customerId: fixture.customer.id,
    warehouseId: fixture.warehouse.id,
    paymentTerm: 'IMMEDIATE',
    payments: [{ paymentMethodId: fixture.cash.id, amount: 8.45, tenderedAmount: 8.45 }],
    lines: [
      {
        sellableType: 'COMBO',
        productId: combo.product.id,
        presentationId: comboPresentation!.id,
        quantity: 1.5,
        discount: 0,
      },
    ],
  });
  expect(invalid.status(), await invalid.text()).toBe(400);
  await stockIs(page, fixture, first, 10);
  await stockIs(page, fixture, second, 10);
  expect(await shiftLedger(page)).toEqual(before);
  expect(
    (await api<{ totalElements: number }>(page, `/sales?customerId=${fixture.customer.id}&size=1`))
      .totalElements
  ).toBe(0);

  await openFractionalPos(page, fixture);
  await addExactItem(page, combo.product.name);
  await discount(page, '0.50', fixture.prefix);
  const sale = await payFractional(page, fixture, '5.13');
  expect(sale.lines).toHaveLength(1);
  expect(sale.lines[0]).toMatchObject({
    productId: combo.product.id,
    quantity: 1,
    preManualSubtotal: 5.63,
    manualDiscountAmount: 0.5,
    subtotal: 5.13,
  });
  await stockIs(page, fixture, first, 9.6875);
  await stockIs(page, fixture, second, 9.75);
  const after = await shiftLedger(page);
  expect(after.cashMovements).toEqual(before.cashMovements);
  expect(after.salesPayments.filter((entry) => entry.saleId === sale.id)).toEqual([
    expect.objectContaining({ amount: 5.13 }),
  ]);

  await page.goto('/quotes?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quotes-new').click();
  const customer = page.getByTestId('quote-form-customer');
  await expect(customer).not.toHaveAttribute('placeholder', /cargando/i);
  await customer.fill(fixture.customer.name);
  await page.getByRole('option', { name: fixture.customer.name, exact: true }).click();
  await page.getByTestId('quote-form-warehouse').click();
  await page.getByRole('option', { name: fixture.warehouse.name, exact: true }).click();
  await page.getByTestId('quote-add-item').click();
  await page.getByTestId('product-search-modal-input').fill(combo.product.name);
  await page.getByTestId(`product-card-${combo.product.id}-${comboPresentation!.id}`).click();
  await expect(page.getByTestId('quote-form-line')).toHaveCount(1);
  const quoteSave = responseFor(page, 'POST', '/quotes');
  await page.getByTestId('quote-form-save').click();
  const quoteResponse = await quoteSave;
  expect(quoteResponse.status(), await quoteResponse.text()).toBe(201);
  const quote = (await quoteResponse.json()) as {
    id: number;
    quoteNumber: string;
    total: number;
    lines: { quantity: number; sellableType: string }[];
  };
  console.log(`${fixture.prefix}: UI quote ${quote.id}`);
  expect(Number(quote.total)).toBe(5.63);
  expect(quote.lines).toEqual([expect.objectContaining({ quantity: 1, sellableType: 'COMBO' })]);
  await page.getByTestId('quote-detail-sell').click();
  await expect(page.getByTestId('pos-quote-panel')).toContainText(quote.quoteNumber);
  const quoteSale = await payFractional(page, fixture, '5.63', '5.63', quote.id);
  await stockIs(page, fixture, first, 9.375);
  await stockIs(page, fixture, second, 9.5);
  expect(await api<{ status: string; saleId: number }>(page, `/quotes/${quote.id}`)).toMatchObject({
    status: 'SOLD',
    saleId: quoteSale.id,
  });

  await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-return-open-create').click();
  const returnCustomer = page.getByTestId('customer-return-customer-search');
  await expect(returnCustomer).not.toHaveAttribute('data-disabled');
  await returnCustomer.fill(fixture.customer.name);
  await page.getByRole('option').filter({ hasText: fixture.customer.name }).click();
  await page.getByTestId('customer-return-sale-search').click();
  await page.getByRole('option', { name: new RegExp(`#${quoteSale.id}\\b`) }).click();
  await page
    .getByTestId('customer-return-warehouse-select')
    .selectOption(String(fixture.warehouse.id));
  await page.getByTestId('customer-return-continue').click();
  const line = quoteSale.lines[0];
  await page.getByTestId(`customer-return-qty-${line.productId}:${line.presentationId}`).fill('1');
  await page
    .getByTestId('customer-return-refund-payment-method-select')
    .selectOption(String(fixture.cash.id));
  const returnResponse = responseFor(page, 'POST', '/returns');
  await page.getByTestId('customer-return-submit').click();
  const returnResult = await returnResponse;
  expect(returnResult.status(), await returnResult.text()).toBe(200);
  const returned = (await returnResult.json()) as { id: number; totalRefunded: number };
  console.log(`${fixture.prefix}: UI return ${returned.id}`);
  expect(Number(returned.totalRefunded)).toBe(5.63);
  await stockIs(page, fixture, first, 9.6875);
  await stockIs(page, fixture, second, 9.75);
  const returnedLedger = await shiftLedger(page);
  expect(returnedLedger.cashMovements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        returnId: returned.id,
        amount: 5.63,
        type: 'OUT',
        paymentMethodId: fixture.cash.id,
      }),
    ])
  );
  expectHttpError(400, `/sales/${quoteSale.id}/void`);
  const blockedVoid = await rawRequest(page, `/sales/${quoteSale.id}/void`, {});
  expect(blockedVoid.status(), await blockedVoid.text()).toBe(400);
  expect(await shiftLedger(page)).toEqual(returnedLedger);
  await stockIs(page, fixture, first, 9.6875);
  await stockIs(page, fixture, second, 9.75);

  await page.goto('/sales-history?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sales-history-search').fill(sale.saleNumber);
  await page.getByTestId(`sale-actions-${sale.id}`).click();
  await page.getByTestId(`sale-void-${sale.id}`).click();
  const voidResponse = responseFor(page, 'POST', `/sales/${sale.id}/void`);
  await page.getByTestId('void-sale-confirm').click();
  const voidResult = await voidResponse;
  expect(voidResult.status(), await voidResult.text()).toBe(200);
  expect((await api<{ status: string }>(page, `/sales/${sale.id}`)).status).toBe('CANCELLED');
  await stockIs(page, fixture, first, 10);
  await stockIs(page, fixture, second, 10);
  const voidLedger = await shiftLedger(page);
  expectHttpError(400, `/sales/${sale.id}/void`);
  const duplicateVoid = await rawRequest(page, `/sales/${sale.id}/void`, {});
  expect(duplicateVoid.status(), await duplicateVoid.text()).toBe(400);
  expect(await shiftLedger(page)).toEqual(voidLedger);
  await stockIs(page, fixture, first, 10);
  await stockIs(page, fixture, second, 10);
});

test('@serial @local @fractional promotions reward only complete quantities and exclude gifts from manual discount', async ({
  page,
}) => {
  const fixture = await seedFractional(page, [10, 10]);
  const [trigger, reward] = fixture.items;
  const promotion = await createPromotionViaApi(page, {
    name: `${fixture.prefix}-Promotion`,
    productId: trigger.id,
    presentationId: trigger.presentation.id,
    triggerQuantity: 1,
    rewardQuantity: 1,
    discountPercentage: 100,
    rewardProductId: reward.id,
    rewardPresentationId: reward.presentation.id,
  });
  console.log(`${fixture.prefix}: owned promotion ${promotion.id}`);
  try {
    await openFractionalPos(page, fixture);
    await addFractional(page, trigger, '0.9');
    await addFractional(page, reward, '1');
    const below = await payFractional(page, fixture, '19.00');
    expect(
      below.lines.map((line) => [line.productId, Number(line.quantity), Number(line.subtotal)])
    ).toEqual(
      expect.arrayContaining([
        [trigger.id, 0.9, 9],
        [reward.id, 1, 10],
      ])
    );
    await stockIs(page, fixture, trigger, 9.1);
    await stockIs(page, fixture, reward, 9);

    await openFractionalPos(page, fixture);
    await addFractional(page, trigger, '1');
    await addFractional(page, reward, '1');
    const whole = await payFractional(page, fixture, '10.00');
    expect(
      whole.lines.map((line) => [line.productId, Number(line.quantity), Number(line.subtotal)])
    ).toEqual(
      expect.arrayContaining([
        [trigger.id, 1, 10],
        [reward.id, 1, 0],
      ])
    );
    await stockIs(page, fixture, trigger, 8.1);
    await stockIs(page, fixture, reward, 8);

    await openFractionalPos(page, fixture);
    await addFractional(page, trigger, '2.5');
    await addFractional(page, reward, '2.5');
    await discount(page, '3.00', fixture.prefix);
    const sale = await payFractional(page, fixture, '27.00');
    expect(Number(sale.preManualTotal)).toBe(30);
    expect(Number(sale.manualDiscountAmount)).toBe(3);
    expect(
      sale.lines.map((line) => [
        line.productId,
        Number(line.quantity),
        Number(line.preManualSubtotal),
        Number(line.manualDiscountAmount),
        Number(line.subtotal),
      ])
    ).toEqual(
      expect.arrayContaining([
        [trigger.id, 2.5, 25, 2.5, 22.5],
        [reward.id, 0.5, 5, 0.5, 4.5],
        [reward.id, 2, 0, 0, 0],
      ])
    );
    expect(sale.lines).toHaveLength(3);
    await stockIs(page, fixture, trigger, 5.6);
    await stockIs(page, fixture, reward, 5.5);
  } finally {
    await deactivatePromotionViaApi(page, promotion);
  }
});
