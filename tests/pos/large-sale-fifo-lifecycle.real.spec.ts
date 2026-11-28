import * as XLSX from 'xlsx';
import type { Page } from '@playwright/test';
import { config } from '@config';
import { expect, test } from '@fixtures';
import { buildApiHeaders } from '../../utils/apiHeaders';
import {
  api,
  fractionalPreflight,
  rawRequest,
  seedFractional,
  type FractionalFixture,
  type FractionalPresentation,
  type FractionalSale,
} from '../../support/flows/fractional.flow';

/**
 * Guards the O(1) sale write path (pooled sequence IDs + JDBC batching) with an invoice larger
 * than both the JDBC batch size and the pooled ID block, where every line spans two FIFO lots.
 * Exact COGS proves each allocation points at the right lot; reusing the stock after a void
 * proves the void restored the same lots.
 */
const LINE_COUNT = 60;
const RETURNED_LINE_COUNT = 30;
const PRICE = 10;
const FIRST_LOT_QUANTITY = 2;
const FIRST_LOT_COST = 0.01;
const SECOND_LOT_QUANTITY = 5;
const SECOND_LOT_COST = 3;
const SOLD_QUANTITY = 3;
const STOCK_BEFORE_SALE = FIRST_LOT_QUANTITY + SECOND_LOT_QUANTITY;
const SALE_TOTAL = LINE_COUNT * SOLD_QUANTITY * PRICE;
const SALE_COGS = LINE_COUNT * (FIRST_LOT_QUANTITY * FIRST_LOT_COST + SECOND_LOT_COST);
const DAY_MS = 24 * 60 * 60 * 1000;

const REQUIRED_PERMISSIONS = [
  'products:create',
  'settings:general:edit',
  'inventory:view',
  'purchases:create',
  'suppliers:create',
  'sales:create',
  'sales:view',
  'sales:void',
  'returns:create',
  'customers:create',
  'warehouses:view',
  'reports:view',
];

interface ProfitSaleRow {
  saleId: number;
  netSales: number;
  costOfGoodsSold: number;
  costStatus: string;
}

interface RemainingQuantity {
  saleLineId: number;
  soldQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
}

interface ImportResult {
  successCount: number;
  failureCount: number;
  messages: string[];
}

interface ImportedPresentation extends FractionalPresentation {
  productName: string;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

function productWorkbook(prefix: string, presentationName: string): Buffer {
  const rows = [
    [
      'Presentation ID (optional - used for updates)',
      'Product Name',
      'SKU',
      'Category',
      'Preferred Supplier (optional)',
      'Description',
      'Presentation Type',
      'Conversion Factor',
      'Cost',
      'Price',
      'Barcode',
    ],
    ...Array.from({ length: LINE_COUNT }, (_, index) => {
      const name = `${prefix}-${index}`;
      return ['', name, name, 'GENERAL', '', '', presentationName, 1, FIRST_LOT_COST, PRICE, ''];
    }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Products');
  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}

function inventoryWorkbook(prefix: string, presentationName: string): Buffer {
  const rows = [
    [
      'SKU',
      'Product Name',
      'Presentation Name',
      'Conversion Factor',
      'Quantity',
      'Presentation Cost',
    ],
    ...Array.from({ length: LINE_COUNT }, (_, index) => {
      const name = `${prefix}-${index}`;
      return [name, name, presentationName, 1, FIRST_LOT_QUANTITY, FIRST_LOT_COST];
    }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Inventory');
  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}

async function importWorkbook(
  page: Page,
  path: string,
  fileName: string,
  workbook: Buffer,
  fields: Record<string, string> = {}
): Promise<ImportResult> {
  const response = await page.request.post(`${config.apiRoot}${path}`, {
    headers: await buildApiHeaders(page),
    multipart: {
      file: {
        name: fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
      },
      ...fields,
    },
  });
  expect(response.ok(), `POST ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as ImportResult;
}

async function receiveSecondLot(page: Page, fixture: FractionalFixture): Promise<void> {
  const supplier = await api<{ id: number }>(page, '/inventory/suppliers', 'POST', {
    name: `${fixture.prefix}-Supplier`,
    active: true,
    paymentTerm: 'CREDIT',
  });
  const receipt = await api<{ id: number }>(page, '/inventory/purchase-receipts', 'POST', {
    supplierId: supplier.id,
    warehouseId: fixture.warehouse.id,
    invoiceRef: `${fixture.prefix}-lot2`,
    paymentTerm: 'CREDIT',
    allowPreferredSupplierOverride: true,
    lines: fixture.items.map((item) => ({
      productId: item.id,
      presentationId: item.presentation.id,
      quantity: SECOND_LOT_QUANTITY,
      presentationCost: SECOND_LOT_COST,
      taxRate: 0,
    })),
  });
  console.log(`${fixture.prefix}: second lot receipt ${receipt.id}`);
}

async function expectStock(page: Page, fixture: FractionalFixture, expected: number[]) {
  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    page,
    '/inventory/stock-balance/all'
  );
  const actual = fixture.items.map((item) =>
    Number(
      balances.find((row) => row.skuId === item.id && row.warehouseId === fixture.warehouse.id)
        ?.onHandQty ?? 0
    )
  );
  expect(actual, `${fixture.prefix}: exact base stock per product`).toEqual(expected);
}

async function createLargeSale(page: Page, fixture: FractionalFixture): Promise<FractionalSale> {
  const response = await rawRequest(page, '/sales', {
    customerId: fixture.customer.id,
    warehouseId: fixture.warehouse.id,
    paymentTerm: 'IMMEDIATE',
    payments: [
      { paymentMethodId: fixture.cash.id, amount: SALE_TOTAL, tenderedAmount: SALE_TOTAL },
    ],
    lines: fixture.items.map((item) => ({
      sellableType: 'PRODUCT',
      productId: item.id,
      presentationId: item.presentation.id,
      quantity: SOLD_QUANTITY,
      discount: 0,
    })),
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as FractionalSale;
  console.log(`${fixture.prefix}: sale ${created.id} with ${created.lines.length} lines`);

  const expectedLines = fixture.items.map((item) => ({
    productId: item.id,
    presentationId: item.presentation.id,
    quantity: SOLD_QUANTITY,
    subtotal: SOLD_QUANTITY * PRICE,
  }));
  const summarize = (sale: FractionalSale) =>
    sale.lines.map((line) => ({
      productId: line.productId,
      presentationId: line.presentationId,
      quantity: Number(line.quantity),
      subtotal: Number(line.subtotal),
    }));

  expect(Number(created.total)).toBe(SALE_TOTAL);
  expect(summarize(created)).toEqual(expectedLines);
  expect(new Set(created.lines.map((line) => line.id)).size, 'Line IDs must be unique').toBe(
    LINE_COUNT
  );

  const persisted = await api<FractionalSale>(page, `/sales/${created.id}`);
  expect(persisted.status).toBe('COMPLETED');
  expect(Number(persisted.total)).toBe(SALE_TOTAL);
  expect(summarize(persisted)).toEqual(expectedLines);
  expect(persisted.lines.map((line) => line.id).sort((a, b) => a - b)).toEqual(
    created.lines.map((line) => line.id).sort((a, b) => a - b)
  );
  return persisted;
}

function dateInZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function profitRow(page: Page, saleId: number): Promise<ProfitSaleRow> {
  const settings = await api<{ timeZone?: string | null }>(
    page,
    `/tenants/${config.tenantId}/settings`
  );
  const timeZone = settings.timeZone || 'UTC';
  const now = new Date();
  // A one-day window keeps the sale in range even if the run crosses midnight.
  const query = new URLSearchParams({
    startDate: dateInZone(new Date(now.getTime() - DAY_MS), timeZone),
    endDate: dateInZone(now, timeZone),
    timeZone,
  });
  const report = await api<{ sales: ProfitSaleRow[] }>(page, `/reports/profit?${query}`);
  const row = report.sales.find((entry) => entry.saleId === saleId);
  expect(row, `Sale ${saleId} must be present in the profit report`).toBeTruthy();
  return row!;
}

async function expectFifoCogs(page: Page, saleId: number): Promise<void> {
  const row = await profitRow(page, saleId);
  expect(row.costStatus).toBe('AVAILABLE');
  expect(Number(row.netSales)).toBeCloseTo(SALE_TOTAL, 4);
  expect(
    Number(row.costOfGoodsSold),
    'Every line must consume the full cheap lot first, then one unit of the expensive lot'
  ).toBeCloseTo(SALE_COGS, 4);
}

test('@serial @configured-target @pos large multi-lot sale keeps FIFO through void, resale and partial return', async ({
  page,
}) => {
  await fractionalPreflight(page, REQUIRED_PERMISSIONS);
  const fixture = await seedFractional(page, []);
  const presentationTypes = await api<{
    content: { id: number; name: string; isDivisible: boolean; abbreviation: string }[];
  }>(page, '/presentation-types');
  const unit = presentationTypes.content.find(
    (type) => type.isDivisible && type.abbreviation?.trim()
  );
  expect(unit, 'Existing divisible unit required; no global policy changes').toBeTruthy();

  const productResult = await importWorkbook(
    page,
    '/import/products/create',
    `${fixture.prefix}-products.xlsx`,
    productWorkbook(fixture.prefix, unit!.name)
  );
  expect(productResult.successCount).toBe(LINE_COUNT);
  expect(productResult.failureCount).toBe(0);

  const expectedNames = Array.from(
    { length: LINE_COUNT },
    (_, index) => `${fixture.prefix}-${index}`
  );
  const presentations = await api<ImportedPresentation[]>(page, '/product-presentations/all');
  const basePresentationByName = new Map(
    presentations
      .filter((presentation) => presentation.isBasePresentation)
      .map((presentation) => [presentation.productName, presentation])
  );
  fixture.items = expectedNames.map((name) => {
    const presentation = basePresentationByName.get(name);
    expect(presentation, `Imported base presentation for ${name}`).toBeTruthy();
    return { id: presentation!.productId, name, presentation: presentation! };
  });
  expect(new Set(fixture.items.map((item) => item.id)).size).toBe(LINE_COUNT);
  expect(new Set(fixture.items.map((item) => item.presentation.id)).size).toBe(LINE_COUNT);

  const inventoryResult = await importWorkbook(
    page,
    `/import/inventory/create`,
    `${fixture.prefix}-initial-stock.xlsx`,
    inventoryWorkbook(fixture.prefix, unit!.name),
    { warehouseId: String(fixture.warehouse.id) }
  );
  expect(inventoryResult.successCount).toBe(LINE_COUNT);
  expect(inventoryResult.failureCount).toBe(0);

  await receiveSecondLot(page, fixture);
  await expectStock(page, fixture, Array(LINE_COUNT).fill(STOCK_BEFORE_SALE));

  const voidedSale = await createLargeSale(page, fixture);
  await expectStock(page, fixture, Array(LINE_COUNT).fill(STOCK_BEFORE_SALE - SOLD_QUANTITY));
  await expectFifoCogs(page, voidedSale.id);

  const voidResponse = await rawRequest(page, `/sales/${voidedSale.id}/void`, {});
  expect(voidResponse.status(), await voidResponse.text()).toBe(200);
  expect((await api<FractionalSale>(page, `/sales/${voidedSale.id}`)).status).toBe('CANCELLED');
  await expectStock(page, fixture, Array(LINE_COUNT).fill(STOCK_BEFORE_SALE));

  // Same COGS again proves the void returned each unit to the lot it came from.
  const keptSale = await createLargeSale(page, fixture);
  await expectStock(page, fixture, Array(LINE_COUNT).fill(STOCK_BEFORE_SALE - SOLD_QUANTITY));
  await expectFifoCogs(page, keptSale.id);

  const returnedLines = keptSale.lines.slice(0, RETURNED_LINE_COUNT);
  const returnResponse = await rawRequest(page, '/returns', {
    saleId: keptSale.id,
    warehouseId: fixture.warehouse.id,
    reasonType: 'CUSTOMER_REGRET',
    refundMethod: 'CASH',
    paymentMethodId: fixture.cash.id,
    items: returnedLines.map((line) => ({
      saleLineId: line.id,
      productId: line.productId,
      presentationId: line.presentationId,
      quantity: 1,
    })),
  });
  expect(returnResponse.status(), await returnResponse.text()).toBe(201);
  const returned = (await returnResponse.json()) as { id: number; totalRefunded: number };
  expect(Number(returned.totalRefunded)).toBeCloseTo(RETURNED_LINE_COUNT * PRICE, 4);

  const remaining = await api<RemainingQuantity[]>(
    page,
    `/returns/sales/${keptSale.id}/remaining-quantities`
  );
  const returnedIds = new Set(returnedLines.map((line) => line.id));
  expect(
    keptSale.lines.map((line) => {
      const entry = remaining.find((candidate) => candidate.saleLineId === line.id);
      return [Number(entry?.returnedQuantity), Number(entry?.remainingQuantity)];
    })
  ).toEqual(
    keptSale.lines.map((line) =>
      returnedIds.has(line.id) ? [1, SOLD_QUANTITY - 1] : [0, SOLD_QUANTITY]
    )
  );
  await expectStock(
    page,
    fixture,
    fixture.items.map((_, index) =>
      index < RETURNED_LINE_COUNT
        ? STOCK_BEFORE_SALE - SOLD_QUANTITY + 1
        : STOCK_BEFORE_SALE - SOLD_QUANTITY
    )
  );
});
