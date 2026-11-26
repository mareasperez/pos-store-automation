import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@fixtures';
import { config } from '@config';
import { buildApiHeaders } from '../../utils/apiHeaders';
import { assertConfiguredTarget } from './target.flow';
import { addExactItem, api, responseFor } from './combos.flow';

export { api, responseFor };

export interface FractionalPresentation {
  id: number;
  productId: number;
  presentationTypeId: number;
  conversionFactor: number;
  price: number;
  cost: number;
  taxRate: number;
  active: boolean;
  isBasePresentation: boolean;
  allowsFractionalQuantity: boolean;
  priceMode: string;
}

export interface FractionalItem {
  id: number;
  name: string;
  presentation: FractionalPresentation;
}

export interface FractionalFixture {
  prefix: string;
  items: FractionalItem[];
  customer: { id: number; name: string };
  warehouse: { id: number; name: string };
  cash: { id: number; code: string };
}

export interface FractionalSale {
  id: number;
  saleNumber: string;
  customerId: number;
  status: string;
  total: number;
  subtotal: number;
  tax: number;
  preManualTotal: number;
  manualDiscountAmount: number;
  payments: { amount: number; tenderedAmount: number }[];
  lines: {
    id: number;
    productId: number;
    presentationId: number;
    quantity: number;
    presentationPrice: number;
    subtotal: number;
    preManualSubtotal: number;
    manualDiscountAmount: number;
    fractionalQuantityAllowed: boolean;
    conversionFactorSnapshot: number;
  }[];
}

export interface ShiftLedger {
  id: number;
  status: string;
  cashMovements: {
    id: number;
    amount: number;
    type: string;
    returnId: number | null;
    paymentMethodId: number;
    currency: string;
    reason: string;
  }[];
  salesPayments: { id: number; saleId: number; amount: number }[];
  paymentReconciliations: { paymentMethodId: number; expectedAmount: number }[];
}

export interface FinancialEntry {
  id: number;
  amount: number;
  status: string;
  sourceId: number;
  direction: string;
  reversalMovementId: number | null;
  reversalOfMovementId: number | null;
}

export async function fractionalPreflight(
  page: Page,
  requiredPermissions: readonly string[] = []
): Promise<void> {
  page.setDefaultTimeout(15_000);
  const assertTargetRequests = await assertConfiguredTarget(page, { requiredPermissions });
  expect((await api<{ status: string }>(page, '/shifts/active')).status).toBe('OPEN');
  expect(
    (await api<{ currency: string }>(page, `/tenants/${config.tenantId}/settings`)).currency
  ).toBe('NIO');
  assertTargetRequests();
}

export async function seedFractional(
  page: Page,
  prices: number[],
  stock = 10,
  factor = 1,
  taxRate = 0
): Promise<FractionalFixture> {
  const prefix = `FC-${randomUUID().slice(0, 8)}`;
  const types = await api<{
    content: { id: number; isDivisible: boolean; abbreviation: string }[];
  }>(page, '/presentation-types');
  const unit = types.content.find((type) => type.isDivisible && type.abbreviation?.trim());
  expect(unit, 'Existing divisible unit required; no global policy changes').toBeTruthy();
  const methods = await api<
    { id: number; code: string; active: boolean; type: string; currency: string }[]
  >(page, '/payment-methods');
  const cash = methods.find(
    (method) => method.active && method.type === 'CASH' && method.currency === 'NIO'
  );
  expect(cash).toBeTruthy();
  const items: FractionalItem[] = [];
  for (const [index, price] of prices.entries()) {
    const name = `${prefix}-${index}`;
    const product = await api<{ id: number }>(page, '/products', 'POST', {
      name,
      sku: name,
      active: true,
      type: 'STANDARD',
      stock,
      basePresentation: {
        presentationTypeId: unit!.id,
        conversionFactor: 1,
        price,
        cost: 0.01,
        taxRate,
        active: true,
        isBasePresentation: true,
        priceMode: 'PRICE_DRIVEN',
        allowsFractionalQuantity: factor === 1,
      },
    });
    console.log(`${prefix}: owned product ${product.id}`);
    const presentations = await api<FractionalPresentation[]>(
      page,
      `/product-presentations?productId=${product.id}`
    );
    const presentation =
      factor === 1
        ? presentations.find((entry) => entry.isBasePresentation)!
        : await api<FractionalPresentation>(
            page,
            `/product-presentations?productId=${product.id}`,
            'POST',
            {
              productId: product.id,
              presentationTypeId: unit!.id,
              conversionFactor: factor,
              price,
              cost: 0.01,
              taxRate,
              barcode: `${name}-factor-${factor}`,
              active: true,
              isBasePresentation: false,
              priceMode: 'PRICE_DRIVEN',
              allowsFractionalQuantity: true,
            }
          );
    expect(presentation.allowsFractionalQuantity).toBe(true);
    items.push({ id: product.id, name, presentation });
  }
  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    page,
    '/inventory/stock-balance/all'
  );
  const initial = balances.find((row) => row.skuId === items[0].id);
  expect(Number(initial?.onHandQty)).toBe(stock);
  const warehouses = await api<{ id: number; name: string; active: boolean }[]>(
    page,
    '/inventory/warehouses'
  );
  const warehouse = warehouses.find((entry) => entry.id === initial!.warehouseId && entry.active);
  expect(warehouse).toBeTruthy();
  const customer = await api<{ id: number; name: string }>(page, '/customers', 'POST', {
    name: `${prefix}-Customer`,
    status: 'ACTIVE',
    creditActive: false,
  });
  console.log(`${prefix}: owned customer ${customer.id}, warehouse ${warehouse!.id}`);
  return { prefix, items, warehouse: warehouse!, cash: cash!, customer };
}

export async function stockIs(
  page: Page,
  fixture: FractionalFixture,
  item: FractionalItem,
  expected: number
): Promise<void> {
  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    page,
    '/inventory/stock-balance/all'
  );
  const row = balances.find(
    (entry) => entry.skuId === item.id && entry.warehouseId === fixture.warehouse.id
  );
  expect(Number(row?.onHandQty ?? 0), `${item.name}: exact base stock`).toBe(expected);
}

export async function openFractionalPos(page: Page, fixture: FractionalFixture): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  await page.locator('select[name="saleWarehouse"]').selectOption(String(fixture.warehouse.id));
  const customer = page.getByTestId('pos-customer-select');
  await expect(customer).not.toHaveAttribute('data-disabled', { timeout: 45_000 });
  await customer.fill(fixture.customer.name);
  await page.getByRole('option').filter({ hasText: fixture.customer.name }).click();
}

export async function quantityEditor(page: Page, item: FractionalItem) {
  const line = page.getByTestId('ticket-line').filter({ hasText: item.name });
  await line.getByRole('button', { name: /^Editar la cantidad de/ }).click();
  return line.getByRole('textbox', { name: `Cantidad de ${item.name}` });
}

export async function setQuantity(page: Page, item: FractionalItem, value: string): Promise<void> {
  const input = await quantityEditor(page, item);
  await input.fill(value);
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(
    page
      .getByTestId('ticket-line')
      .filter({ hasText: item.name })
      .getByRole('button', { name: /^Editar la cantidad de/ })
  ).toHaveText(value);
}

export async function addFractional(
  page: Page,
  item: FractionalItem,
  quantity: string
): Promise<void> {
  if (item.presentation.isBasePresentation) {
    await addExactItem(page, item.name);
  } else {
    await page
      .getByTestId('pos-product-search')
      .fill(`${item.name}-factor-${item.presentation.conversionFactor}`);
    const option = page.getByRole('option').filter({ hasText: item.name });
    await expect(option).toHaveCount(1);
    await option.click();
  }
  await setQuantity(page, item, quantity);
}

export async function discount(page: Page, amount: string, reason: string): Promise<void> {
  await page.getByTestId('pos-manual-discount-open').click();
  await page.getByTestId('pos-manual-discount-amount').fill(amount);
  await page.getByTestId('pos-manual-discount-reason').fill(reason);
  await page.getByTestId('pos-manual-discount-apply').click();
}

export async function payFractional(
  page: Page,
  fixture: FractionalFixture,
  total: string,
  tendered = total,
  quoteId?: number
): Promise<FractionalSale> {
  await expect(page.getByTestId('pos-cart-total')).toContainText(total);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
  await page.getByTestId('payment-method-select').selectOption(fixture.cash.code);
  await page.getByTestId('payment-amount-input').fill(tendered);
  const response = responseFor(page, 'POST', '/sales');
  await page.getByTestId('pm-finalize').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(201);
  const created = (await result.json()) as FractionalSale;
  console.log(`${fixture.prefix}: UI sale ${created.id}`);
  const payload = result.request().postDataJSON() as {
    quoteId?: number;
    changeDue: number;
    lines: { productId: number; quantity: number }[];
  };
  expect(Math.round(payload.changeDue * 100)).toBe(
    Math.round(Number(tendered) * 100) - Math.round(Number(total) * 100)
  );
  if (quoteId !== undefined) {
    expect(payload.quoteId).toBe(quoteId);
    expect(payload.lines).toHaveLength(0);
  } else {
    expect(payload.lines.map((line) => [line.productId, line.quantity])).toEqual(
      created.lines.map((line) => [line.productId, Number(line.quantity)])
    );
  }
  const persisted = await api<FractionalSale>(page, `/sales/${created.id}`);
  expect(persisted.status).toBe('COMPLETED');
  expect(Number(persisted.total)).toBe(Number(total));
  expect(persisted.customerId).toBe(fixture.customer.id);
  expect(
    Math.round(Number(persisted.subtotal) * 100) + Math.round(Number(persisted.tax) * 100)
  ).toBe(Math.round(Number(total) * 100));
  await expect(page.getByTestId('invoice-dialog')).toBeVisible();
  await page.getByTestId('invoice-close').click();
  return persisted;
}

export async function returnFractional(
  page: Page,
  fixture: FractionalFixture,
  sale: FractionalSale,
  quantity: number,
  availability: { returned: number; remaining: number }
): Promise<{ id: number; totalRefunded: number; financialMovementId: number | null }> {
  const line = sale.lines[0];
  await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-return-open-create').click();
  const customer = page.getByTestId('customer-return-customer-search');
  await expect(customer).not.toHaveAttribute('data-disabled');
  await customer.fill(fixture.customer.name);
  await page.getByRole('option').filter({ hasText: fixture.customer.name }).click();
  await page.getByTestId('customer-return-sale-search').click();
  await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();
  await page
    .getByTestId('customer-return-warehouse-select')
    .selectOption(String(fixture.warehouse.id));
  await page.getByTestId('customer-return-continue').click();
  const input = page.getByTestId(`customer-return-qty-${line.productId}:${line.presentationId}`);
  const cells = input.locator('xpath=ancestor::tr').getByRole('cell');
  await expect(cells.nth(2)).toHaveText(String(line.quantity));
  await expect(cells.nth(3)).toHaveText(String(availability.returned));
  await expect(cells.nth(4)).toHaveText(String(availability.remaining));
  await input.fill('1');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('customer-return-submit')).toBeDisabled();
  await input.fill(String(quantity));
  await page
    .getByTestId('customer-return-refund-payment-method-select')
    .selectOption(String(fixture.cash.id));
  const response = responseFor(page, 'POST', '/returns');
  await page.getByTestId('customer-return-submit').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(200);
  const payload = result.request().postDataJSON() as {
    items: { saleLineId: number; quantity: number }[];
  };
  expect(payload.items).toEqual([expect.objectContaining({ saleLineId: line.id, quantity })]);
  const returned = (await result.json()) as {
    id: number;
    totalRefunded: number;
    financialMovementId: number | null;
  };
  const savedReturn = await api<{
    id: number;
    saleId: number;
    status: string;
    totalRefunded: number;
  }>(page, `/returns/${returned.id}`);
  expect(savedReturn).toMatchObject({
    id: returned.id,
    saleId: sale.id,
    status: 'POSTED',
    totalRefunded: returned.totalRefunded,
  });
  console.log(
    `${fixture.prefix}: UI return ${returned.id}, qty ${quantity}, refund ${returned.totalRefunded}`
  );
  await expect(page.getByTestId('customer-return-submit')).toBeHidden();
  return returned;
}

export async function shiftLedger(page: Page): Promise<ShiftLedger> {
  const active = await api<{ id: number }>(page, '/shifts/active');
  return api<ShiftLedger>(
    page,
    `/shifts/${active.id}?includeExpectations=true&includeSalesPayments=true`
  );
}

export function cashCents(shift: ShiftLedger, fixture: FractionalFixture): number {
  const cash = shift.paymentReconciliations.find(
    (entry) => entry.paymentMethodId === fixture.cash.id
  );
  expect(cash).toBeTruthy();
  return Math.round(Number(cash!.expectedAmount) * 100);
}

export async function rawRequest(page: Page, path: string, data: unknown) {
  return page.request.post(`${config.apiRoot}${path}`, {
    headers: await buildApiHeaders(page),
    maxRedirects: 0,
    data,
  });
}
