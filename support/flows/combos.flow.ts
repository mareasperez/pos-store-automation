import { randomUUID } from 'node:crypto';
import type { Page, Response } from '@playwright/test';
import { expect } from '@fixtures';
import { config } from '@config';
import { buildApiHeaders } from '../../utils/apiHeaders';
import { getWarehouseStock } from './quotes.flow';

export interface Presentation {
  id: number;
  presentationTypeId: number;
  conversionFactor: number;
  price: number;
  cost: number;
  taxRate: number;
  active: boolean;
  isBasePresentation: boolean;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  active: boolean;
  type: string;
  basePresentation: Presentation;
}

export interface Combo {
  product: Product;
  components: {
    productId: number;
    presentationId: number;
    quantity: number;
    allocatedSalePrice: number;
  }[];
  salesStartDate: string | null;
  salesEndDate: string | null;
}

export interface Fixture {
  prefix: string;
  physical: Product;
  service: Product;
  pack: Presentation;
  warehouse: { id: number; name: string };
  customer: { id: number; name: string };
  cashId: number;
}

export interface CommercialDocument {
  id: number;
  saleNumber: string;
  quoteNumber: string;
  status: string;
  total: number;
  saleId: number | null;
  customerId: number;
  lines: {
    id: number;
    sellableType: string;
    productId: number;
    presentationId: number;
    quantity: number;
    unitPrice: number;
  }[];
}

export const apiPath = (path: string) => `${config.apiRoot}${path}`;

export function responseFor(page: Page, method: string, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === `/api${path}`
  );
}

export async function api<T>(page: Page, path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await page.request.fetch(apiPath(path), {
    method,
    headers: await buildApiHeaders(page),
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(
    true
  );
  return (await response.json()) as T;
}

export async function localPreflight(page: Page): Promise<void> {
  page.setDefaultTimeout(15_000);
  expect(config.environment, 'Only the explicitly authorized local environment may run C7').toBe(
    'local'
  );
  expect(config.baseUrl).toBe('http://localhost:5173');
  expect(config.apiRoot).toBe('http://localhost:8081/api');
  expect(config.tenantId, 'An explicit local test tenant is required').toBeTruthy();
  const state = await page.context().storageState();
  const origin = state.origins.find((item) => item.origin === config.baseUrl);
  const store = origin?.localStorage.find((item) => item.name === 'pos_app_store');
  const saved = store ? (JSON.parse(store.value) as { state: { activeTenantId: string } }) : null;
  expect(saved?.state.activeTenantId, 'Saved local session must match the authorized tenant').toBe(
    config.tenantId
  );
  const runtime = await page.request.get(`${config.baseUrl}/config/app-config.json`);
  expect(runtime.ok()).toBe(true);
  const runtimeConfig = (await runtime.json()) as { apiUrl: string };
  expect(['localhost', '127.0.0.1']).toContain(new URL(runtimeConfig.apiUrl).hostname);
  expect(new URL(runtimeConfig.apiUrl).port).toBe('8081');
  // Safety boundary only: real local UI/API requests are never intercepted or mocked.
  await page
    .context()
    .route('**/*', (route) =>
      ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
        ? route.continue()
        : route.abort('blockedbyclient')
    );
  const shift = await api<{ id: number; status: string }>(page, '/shifts/active');
  expect(shift.status, 'C7 requires an existing authorized local shift; never closes it').toBe(
    'OPEN'
  );
  console.log(`C7 using existing shift ${shift.id}; it will remain open`);
}

export async function seedFixture(page: Page, stock = 60): Promise<Fixture> {
  const prefix = `C7-${randomUUID().slice(0, 8)}`;
  const warehouses = await api<{ id: number; name: string; active: boolean }[]>(
    page,
    '/inventory/warehouses'
  );
  const warehouse = warehouses.find((item) => item.active);
  expect(warehouse, 'An active local warehouse is required').toBeTruthy();
  const types = await api<{ content: { id: number; code: string }[] }>(page, '/presentation-types');
  const unitId = types.content.find((type) => type.code === 'UNIT')?.id;
  const packTypeId = types.content.find((type) => type.code === 'PACK')?.id;
  expect(unitId).toBeTruthy();
  expect(packTypeId).toBeTruthy();
  const methods = await api<{ id: number; active: boolean; type: string; currency: string }[]>(
    page,
    '/payment-methods'
  );
  const cashId = methods.find(
    (item) => item.active && item.type === 'CASH' && item.currency === 'NIO'
  )?.id;
  expect(cashId, 'An active NIO cash method is required').toBeTruthy();
  const createProduct = (type: 'STANDARD' | 'SERVICE') =>
    api<Product>(page, '/products', 'POST', {
      name: `${prefix}-${type}`,
      sku: `${prefix}-${type}`,
      active: true,
      type,
      stock: type === 'STANDARD' ? stock : 0,
      basePresentation: {
        presentationTypeId: unitId,
        conversionFactor: 1,
        price: type === 'STANDARD' ? 10 : 30,
        cost: type === 'STANDARD' ? 2 : 3,
        taxRate: 0,
        active: true,
        isBasePresentation: true,
        priceMode: 'PRICE_DRIVEN',
      },
    });
  const physical = await createProduct('STANDARD');
  console.log(`C7 fixture ${prefix}: physical product ${physical.id}`);
  const service = await createProduct('SERVICE');
  for (const product of [physical, service]) {
    const presentations = await api<Presentation[]>(
      page,
      `/product-presentations?productId=${product.id}`
    );
    product.basePresentation = presentations.find((item) => item.isBasePresentation)!;
    expect(product.basePresentation).toBeTruthy();
  }
  const pack = await api<Presentation>(
    page,
    `/product-presentations?productId=${physical.id}`,
    'POST',
    {
      productId: physical.id,
      presentationTypeId: packTypeId,
      conversionFactor: 3,
      price: 30,
      cost: 6,
      taxRate: 0,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
    }
  );
  const customer = await api<{ id: number; name: string }>(page, '/customers', 'POST', {
    name: `${prefix}-Customer`,
    status: 'ACTIVE',
    creditActive: false,
  });
  const fixture = {
    prefix,
    physical,
    service,
    pack,
    warehouse: warehouse!,
    customer,
    cashId: cashId!,
  };
  console.log(
    `C7 fixture ${prefix}: service ${service.id}, pack ${pack.id}, customer ${customer.id}`
  );
  await assertStock(page, fixture, stock);
  return fixture;
}

export async function assertStock(page: Page, fixture: Fixture, expected: number): Promise<void> {
  expect(
    await getWarehouseStock(page, fixture.physical.id, fixture.warehouse.id),
    'Physical stock is measured in raw base units, not presentation units'
  ).toBeCloseTo(expected, 6);
  expect(await getWarehouseStock(page, fixture.service.id, fixture.warehouse.id)).toBe(0);
  console.log(`C7 ${fixture.prefix}: base stock=${expected}; SERVICE stock=0`);
}

export async function createComboUi(page: Page, fixture: Fixture, suffix = ''): Promise<Combo> {
  await page.goto('/catalog/combos/new?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Nombre', { exact: true }).fill(`${fixture.prefix}-Combo${suffix}`);
  await page.getByLabel('SKU', { exact: true }).fill(`${fixture.prefix}-Combo${suffix}`);
  for (const product of [fixture.physical, fixture.service]) {
    await page.getByRole('button', { name: 'Agregar productos', exact: true }).click();
    await page.getByTestId('product-search-modal-input').fill(product.name);
    await page.getByTestId(`product-card-${product.id}-${product.basePresentation.id}`).click();
    await expect(page.getByTestId('product-search-modal-input')).toBeHidden();
  }
  const component = page.getByTestId(`combo-component-${fixture.physical.id}`);
  await component.getByRole('combobox').click();
  await page.getByRole('option', { name: /×3/ }).click();
  await component.getByRole('spinbutton', { name: /Cantidad/ }).fill('2');
  await page.locator('#combo-fixed-price').fill('90');
  const response = responseFor(page, 'POST', '/combos');
  await page.getByRole('button', { name: /^Guardar combo$/i }).click();
  const saved = await response;
  expect(saved.status(), await saved.text()).toBe(201);
  const combo = (await saved.json()) as Combo;
  const presentations = await api<Presentation[]>(
    page,
    `/product-presentations?productId=${combo.product.id}`
  );
  combo.product.basePresentation = presentations.find((item) => item.isBasePresentation)!;
  expect(combo.components).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        productId: fixture.physical.id,
        presentationId: fixture.pack.id,
        quantity: 2,
      }),
    ])
  );
  expect(combo.components).toHaveLength(2);
  expect(Number(combo.product.basePresentation.price)).toBe(90);
  console.log(`C7 ${fixture.prefix}: UI-created combo ${combo.product.id}`);
  await expect(page).toHaveURL(/\/catalog\/products/);
  return combo;
}

export async function addExactItem(page: Page, name: string, presentation?: string): Promise<void> {
  await page.getByTestId('pos-product-search').fill(name);
  let matches = page.getByRole('option').filter({ hasText: name });
  if (presentation) matches = matches.filter({ hasText: presentation });
  const option = matches.first();
  await expect(option).toBeVisible();
  await option.click();
}

export async function openPos(page: Page, fixture: Fixture): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pos-customer-select').click();
  await page.getByRole('option').filter({ hasText: fixture.customer.name }).click();
}

export async function checkout(
  page: Page,
  expectedTotal: number,
  expectedStatus = 201
): Promise<CommercialDocument | null> {
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
  await page.getByTestId('payment-amount-input').fill(expectedTotal.toFixed(2));
  const response = responseFor(page, 'POST', '/sales');
  await page.getByTestId('pm-finalize').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(expectedStatus);
  if (expectedStatus !== 201) {
    const error = (await result.json()) as { code: string; message: string };
    expect(error.code).toBe('DOMAIN_ERROR');
    expect(error.message).toMatch(/combo/i);
    await expect(page.getByText(/Es necesario editar y guardar la proforma/)).toBeVisible();
    console.log(`C7 rejected combo sale: ${error.message}`);
    return null;
  }
  const sale = (await result.json()) as CommercialDocument;
  expect(Number(sale.total)).toBeCloseTo(expectedTotal, 2);
  expect(sale.lines).toHaveLength(1);
  expect(sale.lines[0].sellableType).toBe('COMBO');
  console.log(`C7 sale ${sale.id}: total=${sale.total}, one COMBO commercial line`);
  await expect(page.getByTestId('invoice-dialog')).toBeVisible();
  await page.getByTestId('invoice-close').click();
  return sale;
}

export async function createQuoteUi(
  page: Page,
  fixture: Fixture,
  combo: Combo,
  quantity = 2
): Promise<CommercialDocument> {
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
  await page
    .getByTestId(`product-card-${combo.product.id}-${combo.product.basePresentation.id}`)
    .click();
  await expect(page.getByTestId('quote-form-line')).toHaveCount(1);
  await page.getByTestId('quote-line-quantity').fill(String(quantity));
  const response = responseFor(page, 'POST', '/quotes');
  await page.getByTestId('quote-form-save').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(201);
  const quote = (await result.json()) as CommercialDocument;
  expect(quote.lines).toHaveLength(1);
  expect(quote.lines[0].sellableType).toBe('COMBO');
  console.log(`C7 quote ${quote.id}: total=${quote.total}`);
  return quote;
}

export async function openQuoteUi(page: Page, quote: CommercialDocument): Promise<void> {
  await page.goto('/quotes?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('quotes-search').fill(quote.quoteNumber);
  await page.getByTestId('quotes-row').filter({ hasText: quote.quoteNumber }).click();
}

export async function sellQuoteUi(
  page: Page,
  quote: CommercialDocument,
  expectedStatus = 201
): Promise<CommercialDocument | null> {
  await page.getByTestId('quote-detail-sell').click();
  await expect(page.getByTestId('pos-quote-panel')).toContainText(quote.quoteNumber);
  return checkout(page, Number(quote.total), expectedStatus);
}

export async function returnUi(
  page: Page,
  fixture: Fixture,
  sale: CommercialDocument,
  quantity: number,
  expectedStatus = 200
): Promise<{ id: number; totalRefunded: number } | null> {
  await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-return-open-create').click();
  await page.getByTestId('customer-return-customer-search').click();
  await page.getByRole('option').filter({ hasText: fixture.customer.name }).click();
  await page.getByTestId('customer-return-sale-search').click();
  await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();
  await page
    .getByTestId('customer-return-warehouse-select')
    .selectOption(String(fixture.warehouse.id));
  await page.getByTestId('customer-return-continue').click();
  await page
    .getByTestId(`customer-return-qty-${sale.lines[0].productId}:${sale.lines[0].presentationId}`)
    .fill(String(quantity));
  await page
    .getByTestId('customer-return-refund-payment-method-select')
    .selectOption(String(fixture.cashId));
  const response = responseFor(page, 'POST', '/returns');
  await page.getByTestId('customer-return-submit').click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(expectedStatus);
  if (expectedStatus !== 200) {
    const error = (await result.json()) as { code: string; message: string };
    expect(error.code).toBe('DOMAIN_ERROR');
    expect(error.message).toMatch(/quantity exceeds remaining quantity/i);
    await expect(page.getByText(error.message, { exact: true })).toBeVisible();
    return null;
  }
  const returned = (await result.json()) as { id: number; totalRefunded: number };
  console.log(
    `C7 return ${returned.id}: refund=${returned.totalRefunded}, combo units=${quantity}`
  );
  await expect(page.getByTestId('customer-return-submit')).toBeHidden();
  return returned;
}

export async function customerSaleCount(page: Page, fixture: Fixture): Promise<number> {
  const sales = await api<{ totalElements: number }>(
    page,
    `/sales?customerId=${fixture.customer.id}&size=1`
  );
  return sales.totalElements;
}

export async function expectedCash(page: Page, fixture: Fixture): Promise<number> {
  const shift = await api<{
    paymentReconciliations: { paymentMethodId: number; expectedAmount: number }[];
  }>(page, '/shifts/active?includeExpectations=true');
  const cash = shift.paymentReconciliations.find((item) => item.paymentMethodId === fixture.cashId);
  expect(cash).toBeTruthy();
  return Number(cash!.expectedAmount);
}
