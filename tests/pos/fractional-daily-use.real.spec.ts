import path from 'node:path';
import type { Page } from '@playwright/test';
import { config } from '@config';
import { expect, test as base } from '@fixtures';
import { openQuoteUi, type CommercialDocument } from '../../support/flows/combos.flow';
import {
  addFractional,
  api,
  discount,
  fractionalPreflight,
  openFractionalPos,
  payFractional,
  responseFor,
  seedFractional,
  setQuantity,
  type FractionalFixture,
  type FractionalSale,
} from '../../support/flows/fractional.flow';
import { assertThreeDistinctConfiguredActors } from '../fractional/fractional-real.helpers';
import { isConfiguredFrontendOrigin } from '../../utils/target-policy.mjs';

interface DailyEvidence {
  workerIndex: number;
  parallelIndex: number;
  stateFilename: string | null;
  actorId: number | null;
  shiftId?: number;
  startedAt: string;
  finishedAt?: string;
  browserStartedAt?: string;
  browserFinishedAt?: string;
  ownedIds: {
    productIds: number[];
    presentationIds: number[];
    customerId?: number;
    warehouseId?: number;
    draftId?: string;
    quoteId?: number;
    saleId?: number;
  };
}

interface SavedDraft {
  id: string;
  label: string;
  selectedCustomerId: number;
  selectedWarehouseId: number;
  lines: { productId: number; presentationId: number; quantity: number }[];
}

const test = base.extend<{
  daily: { fixture: FractionalFixture; evidence: DailyEvidence };
}>({
  daily: async ({ page, workerStorageState }, use, testInfo) => {
    const evidence: DailyEvidence = {
      workerIndex: testInfo.workerIndex,
      parallelIndex: testInfo.parallelIndex,
      stateFilename: workerStorageState ? path.basename(workerStorageState) : null,
      actorId: null,
      startedAt: new Date().toISOString(),
      ownedIds: { productIds: [], presentationIds: [] },
    };
    try {
      expect(testInfo.config.workers, 'Run this isolated spec with three workers').toBe(3);
      expect(testInfo.retry, 'No automatic test retries').toBe(0);
      expect([0, 1, 2]).toContain(testInfo.parallelIndex);
      assertThreeDistinctConfiguredActors(workerStorageState);
      expect(evidence.stateFilename, 'Never fall back to a shared cashier').toBe(
        `user-${testInfo.parallelIndex}.json`
      );
      const saved = await page.context().storageState();
      expect(saved.cookies.some((cookie) => cookie.name === 'access_token' && cookie.value)).toBe(
        true
      );
      const storage = saved.origins.find((origin) =>
        isConfiguredFrontendOrigin(origin.origin, config.baseUrl)
      )?.localStorage;
      const app = JSON.parse(
        storage?.find((item) => item.name === 'pos_app_store')?.value ?? '{}'
      ) as { state?: { user?: { id?: number | string } } };
      const cart = JSON.parse(
        storage?.find((item) => item.name === 'pos_cart_storage')?.value ?? '{}'
      ) as { state?: { manualDiscountAmountInput?: string; manualDiscountReason?: string } };
      const actorId = Number(app.state?.user?.id);
      evidence.actorId = actorId;
      expect(
        Number.isSafeInteger(actorId) && actorId > 0,
        'Use the actor identity stored in the target-specific session'
      ).toBe(true);
      expect(cart.state?.manualDiscountAmountInput ?? '').toBe('');
      expect(cart.state?.manualDiscountReason ?? '').toBe('');
      await fractionalPreflight(page);
      const shift = await api<{ id: number; userId: number; status: string }>(
        page,
        '/shifts/active'
      );
      expect(shift).toMatchObject({ userId: evidence.actorId, status: 'OPEN' });
      evidence.shiftId = shift.id;
      const fixture = await seedFractional(page, [20]);
      evidence.ownedIds = {
        productIds: fixture.items.map((item) => item.id),
        presentationIds: fixture.items.map((item) => item.presentation.id),
        customerId: fixture.customer.id,
        warehouseId: fixture.warehouse.id,
      };
      evidence.browserStartedAt = new Date().toISOString();
      await use({ fixture, evidence });
    } finally {
      evidence.browserFinishedAt = new Date().toISOString();
      evidence.finishedAt = evidence.browserFinishedAt;
      testInfo.annotations.push({
        type: 'daily-use-worker',
        description: JSON.stringify(evidence),
      });
      await testInfo.attach('daily-use-worker', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      });
    }
  },
});

test.describe.configure({ mode: 'parallel' });
test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 960 } });

async function savedDrafts(page: Page): Promise<SavedDraft[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('pos_cart_storage');
    if (!raw) throw new Error('Expected the test-owned POS cart storage');
    const cart = JSON.parse(raw) as { state: { savedDrafts: SavedDraft[] } };
    return cart.state.savedDrafts.map((draft) => ({
      id: draft.id,
      label: draft.label,
      selectedCustomerId: draft.selectedCustomerId,
      selectedWarehouseId: draft.selectedWarehouseId,
      lines: draft.lines.map(({ productId, presentationId, quantity }) => ({
        productId,
        presentationId,
        quantity,
      })),
    }));
  });
}

async function reopenDraft(
  page: Page,
  fixture: FractionalFixture,
  draft: SavedDraft,
  quantity: string
): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  const search = page.getByTestId('pos-product-search');
  await search.fill(fixture.items[0].name);
  await expect(page.getByRole('option').filter({ hasText: fixture.items[0].name })).toBeVisible();
  await search.fill('');
  const row = page.getByRole('listitem').filter({
    has: page.getByText(draft.label, { exact: true }),
  });
  await row.getByRole('button', { name: 'Retomar', exact: true }).click();
  const line = page.getByTestId('ticket-line').filter({ hasText: fixture.items[0].name });
  await expect(page.getByTestId('ticket-line')).toHaveCount(1);
  await expect(line.getByRole('button', { name: /^Editar la cantidad de/ })).toHaveText(quantity);
  await expect(page.getByTestId('pos-customer-select')).toHaveValue(fixture.customer.name);
  await expect(page.locator('select[name="saleWarehouse"]')).toHaveValue(
    String(fixture.warehouse.id)
  );
}

test('@parallel @configured-target @fractional @daily-use saves, resumes and edits an owned fractional draft', async ({
  page,
  daily: { fixture, evidence },
}) => {
  const item = fixture.items[0];
  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.5');
  await page.getByRole('button', { name: 'Guardar en espera', exact: true }).click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  const drafts = await savedDrafts(page);
  expect(drafts).toHaveLength(1);
  const draft = drafts[0];
  evidence.ownedIds.draftId = draft.id;
  await reopenDraft(page, fixture, draft, '0.5');
  await setQuantity(page, item, '0.75');
  await page.getByRole('button', { name: 'Guardar en espera', exact: true }).click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  expect(await savedDrafts(page)).toEqual([
    expect.objectContaining({
      id: draft.id,
      selectedCustomerId: fixture.customer.id,
      selectedWarehouseId: fixture.warehouse.id,
      lines: [
        expect.objectContaining({
          productId: item.id,
          presentationId: item.presentation.id,
          quantity: 0.75,
        }),
      ],
    }),
  ]);
  await reopenDraft(page, fixture, draft, '0.75');
  await expect(page.getByTestId('pos-cart-total')).toContainText('15.00');
});

test('@parallel @configured-target @fractional @daily-use creates, finds and reopens an edited fractional quote', async ({
  page,
  daily: { fixture, evidence },
}) => {
  const item = fixture.items[0];
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
  const quantity = page.getByTestId('quote-line-quantity');
  await expect(quantity).toBeEnabled();
  await quantity.fill('0.5');
  const creating = responseFor(page, 'POST', '/quotes');
  await page.getByTestId('quote-form-save').click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const quote = (await created.json()) as CommercialDocument;
  evidence.ownedIds.quoteId = quote.id;
  await openQuoteUi(page, quote);
  await expect(page.getByTestId('quote-detail-totals')).toContainText('10.00');
  await page.getByTestId('quote-detail-edit').click();
  await expect(quantity).toBeEnabled();
  await quantity.fill('0.75');
  await expect(page.getByTestId('quote-form-totals')).toContainText('15.00');
  const updating = responseFor(page, 'PUT', `/quotes/${quote.id}`);
  await page.getByTestId('quote-form-save').click();
  expect((await updating).status()).toBe(200);
  await openQuoteUi(page, quote);
  const row = page.getByRole('dialog').getByRole('row').filter({ hasText: item.name });
  await expect(row.getByRole('cell').nth(1)).toHaveText(/^0\.75(?:\s.*)?$/);
  await expect(page.getByTestId('quote-detail-totals')).toContainText('15.00');
  const persisted = await api<CommercialDocument>(page, `/quotes/${quote.id}`);
  expect(persisted).toMatchObject({
    id: quote.id,
    customerId: fixture.customer.id,
    status: 'OPEN',
  });
  expect(persisted.lines).toHaveLength(1);
  expect(persisted.lines[0]).toMatchObject({
    productId: item.id,
    presentationId: item.presentation.id,
  });
  expect(Number(persisted.lines[0].quantity)).toBe(0.75);
  expect(Number(persisted.total)).toBe(15);
});

test('@parallel @configured-target @fractional @manual-discount @daily-use edits a discount and reopens the paid sale receipt', async ({
  page,
  daily: { fixture, evidence },
}) => {
  const item = fixture.items[0];
  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.5');
  await discount(page, '1', `${fixture.prefix}-initial`);
  await expect(page.getByTestId('pos-cart-total')).toContainText('9.00');
  await page.getByTestId('pos-manual-discount-open').click();
  await expect(page.getByTestId('pos-manual-discount-amount')).toHaveValue('1');
  const reason = `${fixture.prefix}-daily-customer`;
  await page.getByTestId('pos-manual-discount-amount').fill('2');
  await page.getByTestId('pos-manual-discount-reason').fill(reason);
  await page.getByTestId('pos-manual-discount-apply').click();
  const sale = await payFractional(page, fixture, '8.00');
  evidence.ownedIds.saleId = sale.id;
  await page.goto('/sales-history?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('sales-history-search').fill(sale.saleNumber);
  const row = page.getByTestId(`sale-row-${sale.id}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(fixture.customer.name);
  await expect(row.locator('[data-status]')).toHaveAttribute('data-status', 'COMPLETED');
  await row.click();
  const details = page.getByRole('dialog');
  await details.getByRole('button', { name: 'Reimprimir ticket', exact: true }).click();
  const invoice = details.getByRole('region');
  await expect(invoice).toBeVisible();
  await expect(invoice).toContainText(fixture.customer.name);
  const receiptLine = invoice.getByRole('row').filter({ hasText: item.name });
  await expect(receiptLine.getByRole('cell').nth(1)).toHaveText(/^0\.5(?:\s.*)?$/);
  await expect(invoice.getByTestId('invoice-line-discount-0')).toBeVisible();
  await expect(invoice.getByTestId('invoice-final-total')).toContainText(/\b8[.,]00\b/);
  await expect(invoice).not.toContainText(reason);
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  const persisted = await api<FractionalSale & { manualDiscountReason: string }>(
    page,
    `/sales/${sale.id}`
  );
  expect(persisted).toMatchObject({
    id: sale.id,
    customerId: fixture.customer.id,
    status: 'COMPLETED',
    manualDiscountReason: reason,
  });
  expect(persisted.lines).toHaveLength(1);
  expect(persisted.lines[0]).toMatchObject({
    productId: item.id,
    presentationId: item.presentation.id,
    fractionalQuantityAllowed: true,
  });
  expect(Number(persisted.lines[0].quantity)).toBe(0.5);
  expect(Number(persisted.manualDiscountAmount)).toBe(2);
  expect(Number(persisted.total)).toBe(8);
});
