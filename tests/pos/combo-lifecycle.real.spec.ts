import { expect, expectHttpError, test } from '@fixtures';
import {
  addExactItem,
  api,
  assertStock,
  checkout,
  createComboUi,
  createQuoteUi,
  customerSaleCount,
  expectedCash,
  localPreflight,
  openPos,
  openQuoteUi,
  responseFor,
  returnUi,
  seedFixture,
  sellQuoteUi,
  type Combo,
  type CommercialDocument,
} from '../../support/flows/combos.flow';

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  await localPreflight(page);
});

test('@serial @combos @local creates, sells, returns whole combos twice, rejects duplicates, voids and resells', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const fixture = await seedFixture(page);
  const cashBefore = await expectedCash(page, fixture);
  const combo = await createComboUi(page, fixture);
  await openPos(page, fixture);
  for (let count = 0; count < 3; count += 1) {
    await addExactItem(page, combo.product.name);
  }
  const sale = (await checkout(page, 270))!;
  expect(sale.lines[0].quantity).toBe(3);
  await assertStock(page, fixture, 60 - 3 * 2 * 3);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 270, 2);

  // A second test-owned sale satisfies the Returns UI customer's hasSales eligibility.
  await openPos(page, fixture);
  await addExactItem(page, combo.product.name);
  await checkout(page, 90);
  await assertStock(page, fixture, 36);
  const first = (await returnUi(page, fixture, sale, 1))!;
  expect(Number(first.totalRefunded)).toBe(90);
  await assertStock(page, fixture, 42);
  const second = (await returnUi(page, fixture, sale, 2))!;
  expect(Number(second.totalRefunded)).toBe(180);
  expect(first.id).not.toBe(second.id);
  await assertStock(page, fixture, 54);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 90, 2);
  expectHttpError(400, '/returns');
  await returnUi(page, fixture, sale, 1, 400);
  await assertStock(page, fixture, 54);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 90, 2);

  await openPos(page, fixture);
  await addExactItem(page, combo.product.name);
  const resale = (await checkout(page, 90))!;
  await assertStock(page, fixture, 48);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 180, 2);
  await page.goto('/sales-history?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sales-history-search').fill(resale.saleNumber);
  await page.getByTestId(`sale-actions-${resale.id}`).click();
  await page.getByTestId(`sale-void-${resale.id}`).click();
  const voidResponse = responseFor(page, 'POST', `/sales/${resale.id}/void`);
  await page.getByTestId('void-sale-confirm').click();
  expect((await voidResponse).status()).toBe(200);
  const voided = await api<CommercialDocument>(page, `/sales/${resale.id}`);
  expect(voided.status).toBe('CANCELLED');
  await assertStock(page, fixture, 54);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 90, 2);
  await openPos(page, fixture);
  await addExactItem(page, combo.product.name);
  await checkout(page, 90);
  await assertStock(page, fixture, 48);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 180, 2);
});

test('@serial @combos @local rejects changed allocations then explicitly edits, reprices and converts the quote', async ({
  page,
}) => {
  const fixture = await seedFixture(page);
  const cashBefore = await expectedCash(page, fixture);
  const combo = await createComboUi(page, fixture);
  const saved = await createQuoteUi(page, fixture, combo);
  expect(Number(saved.total)).toBe(180);
  const repriced: Combo = {
    ...combo,
    product: {
      ...combo.product,
      basePresentation: { ...combo.product.basePresentation, price: 120 },
    },
    components: combo.components.map((component) => ({ ...component, allocatedSalePrice: 40 })),
  };
  await api(page, `/combos/${combo.product.id}`, 'PUT', repriced);
  expectHttpError(400, '/sales');
  await sellQuoteUi(page, saved, 400);
  const rejected = await api<CommercialDocument>(page, `/quotes/${saved.id}`);
  expect(rejected.status).toBe('OPEN');
  expect(rejected.saleId).toBeNull();
  expect(Number(rejected.total)).toBe(180);
  expect(await customerSaleCount(page, fixture)).toBe(0);
  await assertStock(page, fixture, 60);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore, 2);

  await openQuoteUi(page, saved);
  await page.getByTestId('quote-detail-edit').click();
  await expect(page.getByTestId('quote-form-totals')).toContainText('240');
  const editedResponse = responseFor(page, 'PUT', `/quotes/${saved.id}`);
  await page.getByTestId('quote-form-save').click();
  const result = await editedResponse;
  expect(result.status(), await result.text()).toBe(200);
  const edited = (await result.json()) as CommercialDocument;
  expect(Number(edited.total)).toBe(240);
  expect(edited.lines).toHaveLength(1);
  expect(Number(edited.lines[0].unitPrice)).toBe(120);
  const sale = (await sellQuoteUi(page, edited))!;
  expect(sale.lines[0].quantity).toBe(2);
  await assertStock(page, fixture, 60 - 2 * 2 * 3);
  expect(await expectedCash(page, fixture)).toBeCloseTo(cashBefore + 240, 2);
  expect(await customerSaleCount(page, fixture)).toBe(1);
  const persistedSale = await api<CommercialDocument>(page, `/sales/${sale.id}`);
  expect(Number(persistedSale.total)).toBe(240);
  expect(persistedSale.status).toBe('COMPLETED');
  const persistedQuote = await api<CommercialDocument>(page, `/quotes/${saved.id}`);
  expect(persistedQuote.status).toBe('SOLD');
  expect(persistedQuote.saleId).toBe(sale.id);
  expect(Number(persistedQuote.total)).toBe(240);
});

test('@serial @combos @local rejects changed recipe then UI edit recreates current recipe and price', async ({
  page,
}) => {
  const fixture = await seedFixture(page);
  const combo = await createComboUi(page, fixture);
  const stale = await createQuoteUi(page, fixture, combo);
  expect(Number(stale.total)).toBe(180);
  const changed: Combo = {
    ...combo,
    product: {
      ...combo.product,
      basePresentation: { ...combo.product.basePresentation, price: 150 },
    },
    components: combo.components.map((component) => ({
      ...component,
      quantity: component.productId === fixture.physical.id ? 3 : 1,
      allocatedSalePrice: component.productId === fixture.physical.id ? 40 : 30,
    })),
  };
  await api(page, `/combos/${combo.product.id}`, 'PUT', changed);
  const saleCountBefore = await customerSaleCount(page, fixture);
  expectHttpError(400, '/sales');
  await sellQuoteUi(page, stale, 400);
  const unchanged = await api<CommercialDocument>(page, `/quotes/${stale.id}`);
  expect(unchanged.status).toBe('OPEN');
  expect(unchanged.saleId).toBeNull();
  expect(await customerSaleCount(page, fixture)).toBe(saleCountBefore);
  await assertStock(page, fixture, 60);

  await openQuoteUi(page, stale);
  await page.getByTestId('quote-detail-edit').click();
  const editedResponse = responseFor(page, 'PUT', `/quotes/${stale.id}`);
  await page.getByTestId('quote-form-save').click();
  const result = await editedResponse;
  expect(result.status(), await result.text()).toBe(200);
  const edited = (await result.json()) as CommercialDocument;
  expect(Number(edited.total)).toBe(300);
  await sellQuoteUi(page, edited);
  await assertStock(page, fixture, 60 - 2 * 3 * 3);
  const persisted = await api<CommercialDocument>(page, `/quotes/${edited.id}`);
  expect(persisted.status).toBe('SOLD');
  expect(persisted.saleId).toBeTruthy();
});

const ineligibleStates = [
  {
    name: 'inactive',
    change: (combo: Combo): Combo => ({ ...combo, product: { ...combo.product, active: false } }),
  },
  {
    name: 'out-of-season',
    change: (combo: Combo): Combo => ({
      ...combo,
      salesStartDate: '2099-01-01',
      salesEndDate: '2099-12-31',
    }),
  },
];

for (const state of ineligibleStates) {
  test(`@serial @combos @local rejects ${state.name} saved combo quote without stock or sale mutation`, async ({
    page,
  }) => {
    const fixture = await seedFixture(page);
    const combo = await createComboUi(page, fixture);
    const quote = await createQuoteUi(page, fixture, combo);
    const changed = state.change(combo);
    await api(page, `/combos/${combo.product.id}`, 'PUT', changed);
    expectHttpError(400, '/sales');
    await sellQuoteUi(page, quote, 400);
    await assertStock(page, fixture, 60);
    expect(await customerSaleCount(page, fixture)).toBe(0);
    const persisted = await api<CommercialDocument>(page, `/quotes/${quote.id}`);
    expect(persisted.status).toBe('OPEN');
    expect(persisted.saleId).toBeNull();
  });
}

test('@serial @combos @local aggregates overlapping combo and standalone presentation demand', async ({
  page,
}) => {
  const fixture = await seedFixture(page, 12);
  const combo = await createComboUi(page, fixture);
  const otherCombo = await createComboUi(page, fixture, '-Other');
  await openPos(page, fixture);
  await addExactItem(page, combo.product.name);
  await addExactItem(page, otherCombo.product.name);
  await expect(page.getByTestId('ticket-line')).toHaveCount(2);
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeEnabled();
  // Distinct combo lines use 2 * 2 * 3 = 12 base units; a standalone pack needs 1 * 3 more.
  await addExactItem(page, fixture.physical.name, 'Paquete');
  await expect(page.getByTestId('ticket-line')).toHaveCount(3);
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeDisabled();
  await assertStock(page, fixture, 12);
  expect(await customerSaleCount(page, fixture)).toBe(0);
});
