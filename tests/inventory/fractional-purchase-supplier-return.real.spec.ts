import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { config } from '@config';
import {
  addFractional,
  api,
  fractionalPreflight,
  openFractionalPos,
  payFractional,
  rawRequest,
  stockIs,
  type FractionalFixture,
  type FractionalItem,
  type FractionalPresentation,
} from '../../support/flows/fractional.flow';
import {
  createPurchaseWithPresentation,
  type PurchasePresentationCandidate,
} from '../../support/flows/purchases.flow';
import { createSupplier } from '../../support/flows/suppliers.flow';

const TEST_TENANT_ID = '651167cc-9f50-4ff1-a8d7-e9f8a68ccce5';
const PURCHASE_QUANTITY = '0.5';
const PRESENTATION_FACTOR = 12;

interface PresentationType {
  id: number;
  name: string;
  abbreviation?: string;
  isDivisible: boolean;
}

interface PresentationRecord extends FractionalPresentation {
  presentationTypeName?: string;
}

interface SupplierRecord {
  id: number;
  name: string;
  active?: boolean;
}

interface PurchaseReceiptRecord {
  id: number;
  supplierId: number;
  warehouseId: number;
  status: string;
  invoiceRef: string;
  lines: {
    id: number;
    productId: number;
    presentationId: number;
    quantity: number;
  }[];
}

interface SupplierReturnRecord {
  id: number;
  purchaseReceiptId: number;
  supplierId: number;
  warehouseId: number;
  status: string;
  lines: {
    id: number;
    productId: number;
    presentationId: number;
    quantity: number;
  }[];
}

interface OwnedPurchaseFixture extends FractionalFixture {
  supplier: SupplierRecord;
  basePresentation: FractionalPresentation;
}

test.setTimeout(300_000);

async function createOwnedPurchaseFixture(page: Page) {
  await fractionalPreflight(page);
  expect(config.tenantId).toBe(TEST_TENANT_ID);

  const prefix = `FQP-${randomUUID().slice(0, 8)}`;
  const types = await api<{ content: PresentationType[] }>(page, '/presentation-types');
  const baseType = types.content.find((type) => type.isDivisible && type.abbreviation?.trim());
  expect(baseType, 'An existing divisible base unit is required').toBeTruthy();

  const purchaseType = types.content.find(
    (type) => type.id !== baseType!.id && type.name.trim() !== baseType!.name.trim()
  );
  expect(purchaseType, 'A distinct existing presentation type is required').toBeTruthy();

  const product = await api<{ id: number }>(page, '/products', 'POST', {
    name: prefix,
    sku: prefix,
    active: true,
    type: 'STANDARD',
    stock: 10,
    basePresentation: {
      presentationTypeId: baseType!.id,
      conversionFactor: 1,
      price: 10,
      cost: 2,
      taxRate: 0,
      active: true,
      isBasePresentation: true,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: false,
    },
  });

  await api<PresentationRecord>(page, `/product-presentations?productId=${product.id}`, 'POST', {
    productId: product.id,
    presentationTypeId: purchaseType!.id,
    conversionFactor: PRESENTATION_FACTOR,
    price: 10,
    cost: 2,
    taxRate: 0,
    barcode: `${prefix}-factor-${PRESENTATION_FACTOR}`,
    active: true,
    isBasePresentation: false,
    priceMode: 'PRICE_DRIVEN',
    allowsFractionalQuantity: true,
  });

  const presentations = await api<PresentationRecord[]>(
    page,
    `/product-presentations?productId=${product.id}`
  );
  const basePresentation = presentations.find((entry) => entry.isBasePresentation);
  const selectedPresentation = presentations.find(
    (entry) =>
      !entry.isBasePresentation &&
      Number(entry.conversionFactor) === PRESENTATION_FACTOR &&
      entry.allowsFractionalQuantity
  );
  expect(basePresentation).toBeTruthy();
  expect(selectedPresentation, 'The factor-12 presentation must allow fractions').toBeTruthy();
  expect(selectedPresentation!.presentationTypeName).not.toBe(
    basePresentation!.presentationTypeName
  );
  expect(selectedPresentation!.presentationTypeName).toBeTruthy();

  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    page,
    '/inventory/stock-balance/all'
  );
  const initialBalance = balances.find(
    (balance) => balance.skuId === product.id && Number(balance.onHandQty) === 10
  );
  expect(initialBalance, 'The owned product must start with 10 base units').toBeTruthy();

  const warehouses = await api<{ id: number; name: string; active: boolean }[]>(
    page,
    '/inventory/warehouses'
  );
  const warehouse = warehouses.find(
    (entry) => entry.id === initialBalance!.warehouseId && entry.active
  );
  expect(warehouse, 'The initial stock warehouse must be active').toBeTruthy();

  const customer = await api<{ id: number; name: string }>(page, '/customers', 'POST', {
    name: `${prefix}-Customer`,
    status: 'ACTIVE',
    creditActive: false,
  });
  const methods = await api<
    { id: number; code: string; active: boolean; type: string; currency: string }[]
  >(page, '/payment-methods');
  const cash = methods.find(
    (method) => method.active && method.type === 'CASH' && method.currency === 'NIO'
  );
  expect(cash, 'An existing active NIO cash method is required').toBeTruthy();

  const createdSupplier = await createSupplier(page, Date.now(), { uniqueTag: prefix });
  const supplierPayload = await api<SupplierRecord[] | { content?: SupplierRecord[] }>(
    page,
    '/inventory/suppliers?page=0&size=50&sort=createdAt,desc'
  );
  const supplierRows = Array.isArray(supplierPayload)
    ? supplierPayload
    : (supplierPayload.content ?? []);
  const supplier = supplierRows.find(
    (entry) => entry.name === createdSupplier.name && entry.active !== false
  );
  expect(supplier, 'The newly created supplier must be visible to the purchase flow').toBeTruthy();

  const item: FractionalItem = {
    id: product.id,
    name: prefix,
    presentation: selectedPresentation!,
  };
  const fixture: OwnedPurchaseFixture = {
    prefix,
    items: [item],
    customer,
    warehouse: warehouse!,
    cash: cash!,
    supplier: supplier!,
    basePresentation: basePresentation!,
  };

  console.log(
    `${prefix}: owned product ${product.id}, fractional presentation ${selectedPresentation!.id}, ` +
      `supplier ${supplier!.id}, customer ${customer.id}, warehouse ${warehouse!.id}`
  );
  return fixture;
}

function purchaseCandidate(
  fixture: OwnedPurchaseFixture,
  presentation: FractionalPresentation & { presentationTypeName?: string }
): PurchasePresentationCandidate {
  expect(presentation.presentationTypeName).toBeTruthy();
  return {
    supplierId: fixture.supplier.id,
    supplierName: fixture.supplier.name,
    productId: fixture.items[0].id,
    productName: fixture.items[0].name,
    presentationId: presentation.id,
    presentationName: presentation.presentationTypeName!,
    conversionFactor: Number(presentation.conversionFactor),
  };
}

async function findPurchaseReceipt(page: Page, receiptId: number): Promise<PurchaseReceiptRecord> {
  return api<PurchaseReceiptRecord>(page, `/inventory/purchase-receipts/${receiptId}`);
}

async function assertRejectedReturnHasNoEffects(
  page: Page,
  fixture: OwnedPurchaseFixture,
  receipt: PurchaseReceiptRecord,
  presentationId: number,
  quantity: number,
  expectedError: RegExp,
  expectedStock: number
): Promise<void> {
  const returnsBefore = await api<SupplierReturnRecord[]>(page, '/inventory/supplier-returns');
  const ownedBefore = returnsBefore
    .filter((entry) => entry.purchaseReceiptId === receipt.id)
    .map((entry) => entry.id);

  const response = await rawRequest(page, '/inventory/supplier-returns', {
    purchaseReceiptId: receipt.id,
    supplierId: fixture.supplier.id,
    warehouseId: fixture.warehouse.id,
    issuedAt: new Date().toISOString(),
    reason: 'EXCESS_PURCHASE',
    notes: `${fixture.prefix}-invalid-return-guard`,
    lines: [
      {
        productId: fixture.items[0].id,
        presentationId,
        quantity,
        notes: '',
      },
    ],
  });
  const errorBody = await response.text();
  expect(response.status(), errorBody).toBe(400);
  expect(errorBody).toMatch(expectedError);

  const returnsAfter = await api<SupplierReturnRecord[]>(page, '/inventory/supplier-returns');
  const ownedAfter = returnsAfter
    .filter((entry) => entry.purchaseReceiptId === receipt.id)
    .map((entry) => entry.id);
  expect(ownedAfter, 'Rejected supplier returns must not create documents').toEqual(ownedBefore);
  await stockIs(page, fixture, fixture.items[0], expectedStock);
}

test('@local @inventory @serial fractional purchase receipt adds exact stock that can be sold fractionally', async ({
  page,
}) => {
  const fixture = await createOwnedPurchaseFixture(page);
  const item = fixture.items[0];
  await stockIs(page, fixture, item, 10);

  const purchase = await createPurchaseWithPresentation(
    page,
    purchaseCandidate(fixture, item.presentation),
    '10.00',
    PURCHASE_QUANTITY,
    fixture.warehouse.name
  );
  const receipt = await findPurchaseReceipt(page, purchase.id);
  expect(receipt.status).toBe('RECEIVED');
  expect(receipt.supplierId).toBe(fixture.supplier.id);
  expect(receipt.warehouseId).toBe(fixture.warehouse.id);
  expect(receipt.lines).toEqual([
    expect.objectContaining({
      productId: item.id,
      presentationId: item.presentation.id,
      quantity: 0.5,
    }),
  ]);
  expect(Number(item.presentation.conversionFactor)).toBe(PRESENTATION_FACTOR);
  await stockIs(page, fixture, item, 16);
  console.log(`${fixture.prefix}: UI purchase receipt ${receipt.id}; stock 10 -> 16`);

  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.25');
  const sale = await payFractional(page, fixture, '2.50');
  expect(sale.lines).toEqual([
    expect.objectContaining({
      productId: item.id,
      presentationId: item.presentation.id,
      quantity: 0.25,
      conversionFactorSnapshot: PRESENTATION_FACTOR,
    }),
  ]);
  await stockIs(page, fixture, item, 13);
  console.log(`${fixture.prefix}: UI sale ${sale.id}; stock 16 -> 13`);
});

test('@local @inventory @serial supplier return posts a partial fraction linked to its owned receipt', async ({
  page,
}) => {
  const fixture = await createOwnedPurchaseFixture(page);
  const item = fixture.items[0];

  const fractionalPurchase = await createPurchaseWithPresentation(
    page,
    purchaseCandidate(fixture, item.presentation),
    '10.00',
    PURCHASE_QUANTITY,
    fixture.warehouse.name
  );
  const receipt = await findPurchaseReceipt(page, fractionalPurchase.id);
  expect(receipt.status).toBe('RECEIVED');
  expect(receipt.lines).toEqual([
    expect.objectContaining({
      productId: item.id,
      presentationId: item.presentation.id,
      quantity: 0.5,
    }),
  ]);
  await stockIs(page, fixture, item, 16);

  await page.goto('/inventory/returns/new', { waitUntil: 'domcontentloaded' });
  const warehouseInput = page.getByRole('combobox', { name: /^(almac[eé]n|warehouse)$/i });
  await expect(warehouseInput).toBeVisible({ timeout: 45_000 });
  await warehouseInput.click();
  await page.getByRole('option', { name: fixture.warehouse.name, exact: true }).click();
  await expect(warehouseInput).toBeFocused();

  const supplierInput = page.getByPlaceholder(/seleccionar proveedor|select supplier/i);
  await expect(supplierInput).not.toHaveAttribute('data-disabled');
  await supplierInput.fill(fixture.supplier.name);
  await page.getByRole('option').filter({ hasText: fixture.supplier.name }).click();

  const receiptInput = page.getByLabel(/documento de origen|origin doc/i);
  await expect(receiptInput).toBeEnabled({ timeout: 45_000 });
  await receiptInput.fill(receipt.invoiceRef);
  await page.getByRole('option').filter({ hasText: receipt.invoiceRef }).click();

  const reasonInput = page.getByRole('combobox', { name: /^(motivo|reason)$/i });
  await reasonInput.click();
  await page
    .getByRole('option')
    .filter({ hasText: /dañad|damaged/i })
    .click();
  await expect(reasonInput).toBeFocused();

  const lineRow = page.locator('tbody tr').filter({ hasText: item.name });
  const quantityInput = lineRow.locator('input[type="text"]').first();
  await expect(quantityInput).toHaveValue('0.5');
  await quantityInput.fill('0.25');
  await expect(quantityInput).toHaveValue('0.25');

  const createReturn = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/inventory/supplier-returns'
  );
  await page.getByRole('button', { name: /generar|generate/i }).click();
  const response = await createReturn;
  expect(response.status(), await response.text()).toBe(201);
  const request = response.request().postDataJSON() as {
    purchaseReceiptId: number;
    supplierId: number;
    warehouseId: number;
    lines: { productId: number; presentationId: number; quantity: number }[];
  };
  expect(request).toMatchObject({
    purchaseReceiptId: receipt.id,
    supplierId: fixture.supplier.id,
    warehouseId: fixture.warehouse.id,
    lines: [{ productId: item.id, presentationId: item.presentation.id, quantity: 0.25 }],
  });
  expect(request.lines[0]).not.toHaveProperty('purchaseReceiptLineId');

  const created = (await response.json()) as SupplierReturnRecord;
  const persisted = await api<SupplierReturnRecord>(
    page,
    `/inventory/supplier-returns/${created.id}`
  );
  expect(persisted).toMatchObject({
    id: created.id,
    purchaseReceiptId: receipt.id,
    supplierId: fixture.supplier.id,
    warehouseId: fixture.warehouse.id,
    status: 'POSTED',
    lines: [
      expect.objectContaining({
        productId: item.id,
        presentationId: item.presentation.id,
        quantity: 0.25,
      }),
    ],
  });
  await stockIs(page, fixture, item, 13);
  console.log(
    `${fixture.prefix}: UI receipt ${receipt.id}, supplier return ${created.id}; stock 16 -> 13`
  );

  const basePurchase = await createPurchaseWithPresentation(
    page,
    purchaseCandidate(fixture, fixture.basePresentation),
    '10.00',
    '1',
    fixture.warehouse.name
  );
  const baseReceipt = await findPurchaseReceipt(page, basePurchase.id);
  expect(baseReceipt.lines).toEqual([
    expect.objectContaining({
      productId: item.id,
      presentationId: fixture.basePresentation.id,
      quantity: 1,
    }),
  ]);
  await stockIs(page, fixture, item, 14);

  await assertRejectedReturnHasNoEffects(
    page,
    fixture,
    receipt,
    item.presentation.id,
    0.25001,
    /quantity.*(4 decimal|decimal places|NUMERIC)/i,
    14
  );
  await assertRejectedReturnHasNoEffects(
    page,
    fixture,
    baseReceipt,
    fixture.basePresentation.id,
    0.5,
    /presentation does not allow fractional quantities/i,
    14
  );
  console.log(
    `${fixture.prefix}: API-only supplier-return precision and eligibility guards preserved stock 14`
  );
});
