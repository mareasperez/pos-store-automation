import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { addExactItem, responseFor } from '../../support/flows/combos.flow';
import { buildApiHeaders } from '../../utils/apiHeaders';

test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 960 } });

type Product = { id: number; name: string };
type SavedSale = {
  id: number;
  customerId: number;
  preManualTotal: number;
  manualDiscountAmount: number;
  manualDiscountReason: string;
  total: number;
  status: string;
  lines: {
    productId: number;
    quantity: number;
    fractionalQuantityAllowed: boolean;
    unitAbbreviation: string | null;
    preManualSubtotal: number;
    manualDiscountAmount: number;
    subtotal: number;
  }[];
};

async function api<T>(page: Page, path: string, data?: unknown): Promise<T> {
  const response = await page.request.fetch(`${config.apiRoot}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: await buildApiHeaders(page),
    maxRedirects: 0,
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  expect(config.environment, 'This financial spec is local-only').toBe('local');
  expect(config.baseUrl).toBe('http://localhost:5173');
  expect(config.apiRoot).toBe('http://localhost:8081/api');
  expect(config.tenantId, 'Explicit isolated local test tenant required').toBeTruthy();
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    const isLocal = [
      'http://localhost:5173',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
    ].includes(url.origin);
    const isAuthenticationMutation = /\/auth\/(?:login|refresh)(?:\/|$)/.test(url.pathname);
    return isLocal && !isAuthenticationMutation ? route.continue() : route.abort('blockedbyclient');
  });
  const state = await page.context().storageState();
  const storage = state.origins.find((origin) => origin.origin === config.baseUrl)?.localStorage;
  const savedApp = storage?.find((item) => item.name === 'pos_app_store');
  const app = savedApp
    ? (JSON.parse(savedApp.value) as {
        state: { activeTenantId: string; user?: { permissions?: string[] } };
      })
    : undefined;
  expect(app?.state.activeTenantId, 'Saved localhost tenant must match').toBe(config.tenantId);
  expect(app?.state.user?.permissions, 'A saved discount-authorized cashier is required').toContain(
    'sales:discount'
  );
  const savedCart = storage?.find((item) => item.name === 'pos_cart_storage');
  const cart = savedCart
    ? (JSON.parse(savedCart.value) as {
        state: { lines?: unknown[]; savedDrafts?: unknown[]; manualDiscountAmountInput?: string };
      })
    : undefined;
  expect(cart?.state.lines ?? [], 'Never resume a saved user cart').toHaveLength(0);
  expect(cart?.state.savedDrafts ?? [], 'Never alter saved user drafts').toHaveLength(0);
  expect(cart?.state.manualDiscountAmountInput ?? '').toBe('');
  const runtime = await page.request.get(`${config.baseUrl}/config/app-config.json`, {
    maxRedirects: 0,
  });
  expect(runtime.ok()).toBe(true);
  const runtimeConfig = (await runtime.json()) as { apiUrl: string };
  expect(['http://localhost:8081', 'http://127.0.0.1:8081']).toContain(
    new URL(runtimeConfig.apiUrl).origin
  );
  const shift = await api<{ status: string }>(page, '/shifts/active');
  expect(shift.status, 'Requires existing open shift; never opens or closes one').toBe('OPEN');
});

async function arrangeCart(page: Page, mode: 'whole' | 'fractional' = 'whole') {
  const prefix = `MD-${randomUUID().slice(0, 8)}`;
  const settings = await api<{ currency: string; locale?: string }>(
    page,
    `/tenants/${config.tenantId}/settings`
  );
  expect(settings.currency, 'NIO base currency required; configuration is never changed').toBe(
    'NIO'
  );
  const types = await api<{
    content: { id: number; code: string; isDivisible: boolean; abbreviation?: string }[];
  }>(page, '/presentation-types');
  const unitId = types.content.find((type) => type.code === 'UNIT')?.id;
  expect(unitId, 'UNIT presentation required').toBeTruthy();
  const divisibleType = types.content.find(
    (type) => type.isDivisible && Boolean(type.abbreviation?.trim())
  );
  if (mode === 'fractional') {
    expect(
      divisibleType,
      'Existing divisible presentation type with abbreviation required; never changes unit policy'
    ).toBeTruthy();
  }
  const warehouses = await api<{ id: number; active: boolean }[]>(page, '/inventory/warehouses');
  let warehouse = warehouses.find((item) => item.active);
  expect(warehouse, 'Active warehouse required').toBeTruthy();
  const methods = await api<{ code: string; active: boolean; type: string; currency: string }[]>(
    page,
    '/payment-methods'
  );
  const cash = methods.find(
    (method) => method.active && method.type === 'CASH' && method.currency === 'NIO'
  );
  expect(cash, 'Active NIO CASH method and NIO base currency required').toBeTruthy();
  const products: Product[] = [];
  for (const [index, price] of [100, 50].entries()) {
    const fractional = mode === 'fractional' && index === 0;
    const product = await api<Product>(page, '/products', {
      name: `${prefix}-${price}`,
      sku: `${prefix}-${price}`,
      active: true,
      type: fractional ? 'STANDARD' : 'SERVICE',
      stock: fractional ? 10 : 0,
      basePresentation: {
        presentationTypeId: fractional ? divisibleType!.id : unitId,
        conversionFactor: 1,
        price: fractional ? 200 : price,
        cost: fractional ? 2 : 0,
        taxRate: 0,
        active: true,
        isBasePresentation: true,
        priceMode: 'PRICE_DRIVEN',
        allowsFractionalQuantity: fractional,
      },
    });
    products.push(product);
    console.log(`Manual discount fixture ${prefix}: product ${product.id}`);
  }
  if (mode === 'fractional') {
    const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
      page,
      '/inventory/stock-balance/all'
    );
    const initial = balances.find(
      (row) => row.skuId === products[0].id && Number(row.onHandQty) === 10
    );
    expect(
      initial,
      'Test-owned initial stock must be posted into one active warehouse'
    ).toBeTruthy();
    warehouse = warehouses.find((item) => item.id === initial!.warehouseId && item.active);
    expect(warehouse).toBeTruthy();
  }
  const customer = await api<{ id: number; name: string }>(page, '/customers', {
    name: `${prefix}-Customer`,
    status: 'ACTIVE',
    creditActive: false,
  });
  console.log(`Manual discount fixture ${prefix}: customer ${customer.id}`);
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  await expect(page.getByTestId('pos-manual-discount-open')).toBeDisabled();
  await page.locator('select[name="saleWarehouse"]').selectOption(String(warehouse!.id));
  const customerInput = page.getByTestId('pos-customer-select');
  await expect(
    customerInput,
    'Wait for the customer list before entering a search'
  ).not.toHaveAttribute('data-disabled');
  await customerInput.click();
  await customerInput.press('ControlOrMeta+A');
  await customerInput.pressSequentially(customer.name);
  await expect(customerInput).toHaveValue(customer.name);
  await customerInput.press('ArrowDown');
  await page.getByRole('option').filter({ hasText: customer.name }).click();
  for (const product of products) await addExactItem(page, product.name);
  await expect(page.getByTestId('ticket-line')).toHaveCount(2);
  if (mode === 'fractional') {
    const line = page.getByTestId('ticket-line').filter({ hasText: products[0].name });
    await line.getByRole('button', { name: /^Editar la cantidad de/ }).click();
    const quantity = line.getByRole('textbox', { name: `Cantidad de ${products[0].name}` });
    await quantity.fill('0.5');
    await quantity.press('Enter');
    await expect(quantity).toBeHidden();
    await expect(line.getByRole('button', { name: /^Editar la cantidad de/ })).toHaveText('0.5');
  }
  await expect(page.getByTestId('pos-cart-total')).toContainText('150.00');
  await expect(page.getByTestId('pos-manual-discount-open')).toBeEnabled();
  return {
    products,
    customer,
    cash: cash!,
    prefix,
    receiptLocale: settings.locale || 'es',
    warehouseId: warehouse!.id,
    unitAbbreviation: divisibleType?.abbreviation,
  };
}

async function openDiscount(page: Page) {
  await page.getByTestId('pos-manual-discount-open').click();
  const amount = page.getByTestId('pos-manual-discount-amount');
  await expect(amount).toBeVisible();
  return amount;
}

test('@serial @local @pos @manual-discount validates, discards edits, clears and restores a test-owned draft', async ({
  page,
}) => {
  const fixture = await arrangeCart(page);
  const drafts = page.getByRole('button', { name: /Ventas en proceso/ });
  await expect(drafts).toHaveAttribute('aria-expanded', 'true');
  const amount = await openDiscount(page);
  const apply = page.getByTestId('pos-manual-discount-apply');
  await expect(amount).toHaveAttribute('required', '');
  await expect(apply).toBeDisabled();
  await amount.press('Enter');
  await expect(amount).toBeVisible();
  for (const invalid of ['-1', '150.01', '1.001']) {
    await amount.fill(invalid);
    await expect(apply).toBeDisabled();
  }
  await amount.fill('10');
  await page.getByTestId('pos-manual-discount-reason').fill('Internal draft reason');
  await amount.press('Enter');
  await expect(amount).toBeHidden();
  await expect(page.getByTestId('pos-cart-total')).toContainText('140.00');
  await expect(drafts).toHaveAttribute('aria-expanded', 'false');
  await drafts.click();
  await expect(drafts).toHaveAttribute('aria-expanded', 'true');
  await drafts.click();

  await openDiscount(page);
  await amount.fill('20');
  await page.getByTestId('pos-manual-discount-reason').fill('Discard this');
  await page.mouse.click(5, 5);
  await expect(amount).toBeVisible();
  await expect(amount).toHaveValue('20');
  await page.getByTestId('pos-manual-discount-cancel').click();
  await openDiscount(page);
  await expect(amount).toHaveValue('10');
  await expect(page.getByTestId('pos-manual-discount-reason')).toHaveValue('Internal draft reason');
  await amount.fill('30');
  await amount.press('Escape');
  await expect(amount).toBeHidden();
  await expect(page.getByTestId('pos-cart-total')).toContainText('140.00');

  await openDiscount(page);
  await amount.fill('15');
  await page.getByTestId('pos-manual-discount-reason').press('Enter');
  await expect(amount).toBeHidden();
  await expect(page.getByTestId('pos-cart-total')).toContainText('135.00');
  await page.getByRole('button', { name: 'Guardar en espera', exact: true }).click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('pos-product-search').fill(fixture.products[0].name);
  await expect(
    page.getByRole('option').filter({ hasText: fixture.products[0].name })
  ).toBeVisible();
  await page.getByTestId('pos-product-search').fill('');
  await page.getByRole('button', { name: 'Retomar', exact: true }).click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(2);
  await expect(page.getByTestId('pos-cart-total')).toContainText('135.00');
  await openDiscount(page);
  await expect(amount).toHaveValue('15');
  await expect(page.getByTestId('pos-manual-discount-reason')).toHaveValue('Internal draft reason');
  await page.getByTestId('pos-manual-discount-cancel').click();
  await page.getByTestId('pos-manual-discount-remove').click();
  await expect(page.getByTestId('pos-manual-discount-remove')).toBeHidden();
  await expect(page.getByTestId('pos-cart-total')).toContainText('150.00');
  await expect(drafts).toHaveAttribute('aria-expanded', 'true');
  await openDiscount(page);
  await expect(amount).toHaveValue('');
  await expect(page.getByTestId('pos-manual-discount-reason')).toHaveValue('');
  await amount.fill('0');
  await page.getByTestId('pos-manual-discount-apply').click();
  await expect(page.getByTestId('pos-cart-total')).toContainText('150.00');
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeEnabled();
});

test('@serial @local @pos @manual-discount @fractional persists unequal-line allocation, exact stock and receipt', async ({
  page,
}) => {
  const fixture = await arrangeCart(page, 'fractional');
  const amount = await openDiscount(page);
  await amount.fill('10');
  const reason = `${fixture.prefix}-internal-only`;
  await page.getByTestId('pos-manual-discount-reason').fill(reason);
  await page.getByTestId('pos-manual-discount-apply').click();
  const summary = page.getByTestId('pos-cart-total').locator('xpath=../..');
  await expect(summary.getByText('Subtotal', { exact: true })).toHaveCount(1);
  await expect(summary.getByText('Descuento', { exact: true })).toHaveCount(1);
  await expect(summary.getByText('Total a pagar', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pos-cart-total')).toContainText('140.00');
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
  await page.getByTestId('payment-method-select').selectOption(fixture.cash.code);
  await page.getByTestId('payment-amount-input').fill('140.00');
  const createdResponse = responseFor(page, 'POST', '/sales');
  await page.getByTestId('pm-finalize').click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const payload = response.request().postDataJSON() as {
    manualDiscountAmount: number;
    manualDiscountReason: string;
    lines: Record<string, unknown>[];
  };
  expect(payload.manualDiscountAmount).toBe(10);
  expect(payload.manualDiscountReason).toBe(reason);
  expect(payload.lines).toHaveLength(2);
  expect(payload.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ productId: fixture.products[0].id, quantity: 0.5 }),
      expect.objectContaining({ productId: fixture.products[1].id, quantity: 1 }),
    ])
  );
  for (const line of payload.lines) {
    expect(line).not.toHaveProperty('manualDiscountAmount');
    expect(line).not.toHaveProperty('price');
  }
  const created = (await response.json()) as SavedSale;
  console.log(`Manual discount fixture ${fixture.prefix}: completed sale ${created.id}`);
  const persisted = await api<SavedSale>(page, `/sales/${created.id}`);
  expect(persisted.status).toBe('COMPLETED');
  expect(persisted.customerId).toBe(fixture.customer.id);
  expect(Number(persisted.preManualTotal)).toBe(150);
  expect(Number(persisted.manualDiscountAmount)).toBe(10);
  expect(Number(persisted.total)).toBe(140);
  expect(persisted.manualDiscountReason).toBe(reason);
  expect(persisted.lines).toHaveLength(2);
  const invoice = page.getByTestId('invoice-dialog');
  const receiptMoney = (value: number) =>
    new Intl.NumberFormat(fixture.receiptLocale, { style: 'currency', currency: 'NIO' }).format(
      value
    );
  await expect(invoice).toBeVisible();
  const expectedLines = [
    { product: fixture.products[0], gross: 100, allocated: 6.67, quantity: 0.5 },
    { product: fixture.products[1], gross: 50, allocated: 3.33, quantity: 1 },
  ];
  for (const { product, gross, allocated, quantity } of expectedLines) {
    const line = persisted.lines.find((item) => item.productId === product.id);
    expect(line).toBeTruthy();
    expect(Number(line!.preManualSubtotal)).toBe(gross);
    expect(Number(line!.manualDiscountAmount)).toBe(allocated);
    expect(Number(line!.subtotal)).toBe(gross - allocated);
    expect(Number(line!.quantity)).toBe(quantity);
    const receiptRow = invoice.getByRole('row').filter({ hasText: product.name });
    await expect(receiptRow.getByRole('cell').last()).toHaveText(receiptMoney(gross));
    const lineIndex = created.lines.findIndex((item) => item.productId === product.id);
    await expect(invoice.getByTestId(`invoice-line-discount-${lineIndex}`)).toContainText(
      receiptMoney(-allocated)
    );
  }
  const fractionalLine = persisted.lines.find((line) => line.productId === fixture.products[0].id)!;
  expect(fractionalLine.fractionalQuantityAllowed).toBe(true);
  expect(fractionalLine.unitAbbreviation).toBe(fixture.unitAbbreviation);
  await expect(
    invoice.getByRole('row').filter({ hasText: fixture.products[0].name }).getByRole('cell').nth(1)
  ).toHaveText(`0.5 ${fixture.unitAbbreviation}`);
  expect(
    persisted.lines.reduce(
      (sum, line) => sum + Math.round(Number(line.manualDiscountAmount) * 100),
      0
    )
  ).toBe(1000);
  await expect(invoice.getByTestId('invoice-subtotal')).toContainText(receiptMoney(150));
  await expect(invoice.getByTestId('invoice-discounts')).toContainText(receiptMoney(10));
  await expect(invoice.getByTestId('invoice-final-total')).toContainText(receiptMoney(140));
  await expect(invoice).not.toContainText(reason);
  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    page,
    '/inventory/stock-balance/all'
  );
  const remaining = balances.find(
    (row) => row.skuId === fixture.products[0].id && row.warehouseId === fixture.warehouseId
  );
  expect(remaining, 'Physical product balance must survive the fractional sale').toBeTruthy();
  expect(Number(remaining!.onHandQty), '10 - (0.5 × factor 1), without flooring').toBe(9.5);
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('ticket-line')).toHaveCount(0);
});
