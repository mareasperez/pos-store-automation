import { randomUUID } from 'node:crypto';
import { config } from '@config';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { addFractional, api, type FractionalItem } from '../../support/flows/fractional.flow';
import {
  addExactItem,
  createComboUi,
  openPos,
  seedFixture,
  type Fixture as ComboFixture,
} from '../../support/flows/combos.flow';
import {
  createPurchaseWithPresentation,
  type PurchasePresentationCandidate,
} from '../../support/flows/purchases.flow';
import { assertConfiguredTarget } from '../../support/flows/target.flow';

const FACTOR = 4;
const INITIAL_QUANTITY = 8;
const INITIAL_UNIT_COST = 10;
const PURCHASE_QUANTITY = 12;
const PURCHASE_UNIT_COST = 12.0001;
const ORIGINAL_QUANTITY = 5;
const ORIGINAL_PRICE = 100;
const UPDATED_PRICE = 120;
const TOTAL_SOURCE_COST = 224.0012;
const MIXED_SOURCE_COST = 26;
const REPORT_TIME_ZONE = 'America/Managua';

interface PresentationType {
  id: number;
  code: string;
  isDivisible: boolean;
}

interface Presentation {
  id: number;
  productId: number;
  presentationTypeId: number;
  presentationTypeName?: string;
  conversionFactor: number;
  price: number;
  cost: number;
  taxRate: number;
  active: boolean;
  isBasePresentation: boolean;
  allowsFractionalQuantity: boolean;
  priceMode: string;
  barcode?: string;
}

interface Supplier {
  id: number;
  name: string;
  active?: boolean;
}

interface Warehouse {
  id: number;
  name: string;
  active: boolean;
}

interface StockBalance {
  skuId: number;
  warehouseId: number;
  onHandQty: number;
}

interface PaymentMethod {
  id: number;
  code: string;
  type: string;
  currency: string;
  active: boolean;
}

interface SaleLine {
  id: number;
  productId: number;
  presentationId: number;
  quantity: number;
  presentationPrice: number;
  sellableType?: string;
}

interface Sale {
  id: number;
  customerId: number;
  total: number;
  status: string;
  createdAt: string;
  lines: SaleLine[];
}

interface RemainingQuantity {
  saleLineId: number;
  soldQuantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
}

interface ReturnRecord {
  id: number;
  saleId: number;
  status: string;
  totalRefunded: number;
  refundPaymentMethodId: number | null;
}

interface Shift {
  id: number;
  userId: number;
  status: string;
  paymentReconciliations: { paymentMethodId: number; expectedAmount: number }[];
}

interface ProfitSaleRow {
  saleId: number;
  netSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  costStatus: string;
}

interface ProfitReport {
  sales: ProfitSaleRow[];
}

interface Measurement {
  step: string;
  stockBaseUnits: number;
  reportNetSales: number;
  reportCostOfGoodsSold: number;
  reportGrossProfit: number;
  impliedStockValuation: number;
  costStatuses: string[];
}

const REQUIRED_PERMISSIONS = [
  'products:create',
  'products:edit',
  'inventory:view',
  'purchases:create',
  'suppliers:view',
  'sales:create',
  'sales:view',
  'returns:create',
  'customers:view',
  'settings:general:view',
  'warehouses:view',
  'reports:view',
];

interface OwnedFixture {
  prefix: string;
  item: FractionalItem;
  basePresentation: Presentation;
  warehouse: Warehouse;
  supplier: Supplier;
  cash: PaymentMethod;
}

async function configuredMutationPreflight(page: Page): Promise<() => void> {
  return assertConfiguredTarget(page, { requiredPermissions: REQUIRED_PERMISSIONS });
}

async function assertShiftOwner(page: Page, shift: Shift): Promise<void> {
  const state = await page.context().storageState();
  const origin = state.origins.find((item) => item.origin === new URL(config.baseUrl).origin);
  const store = origin?.localStorage.find((item) => item.name === 'pos_app_store');
  const saved = store
    ? (JSON.parse(store.value) as { state?: { user?: { id?: number; username?: string } } })
    : null;
  const user = saved?.state?.user;
  const actor = await api<{ username: string }>(page, '/me');
  expect(user?.id, 'Saved actor ID is required').toBeTruthy();
  expect(user?.username, 'Saved actor username is required').toBeTruthy();
  expect(actor.username, 'Saved actor must match the authenticated actor').toBe(user?.username);
  expect(shift.userId, 'The authenticated cashier must own the already-open shift').toBe(user?.id);
}

async function firstActiveSupplier(page: Page): Promise<Supplier> {
  const payload = await api<Supplier[] | { content?: Supplier[] }>(
    page,
    '/inventory/suppliers?page=0&size=50&sort=createdAt,desc'
  );
  const suppliers = Array.isArray(payload) ? payload : (payload.content ?? []);
  const supplier = suppliers.find((candidate) => candidate.active !== false);
  expect(supplier, 'An active supplier is required to create a FIFO purchase lot').toBeTruthy();
  return supplier!;
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

function expectMoney(actual: number, expected: number, message: string): void {
  expect(actual, message).toBeCloseTo(expected, 4);
}

function dateInReportZone(value: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

async function createOwnedFixture(page: Page): Promise<OwnedFixture> {
  const prefix = `ORF-${randomUUID().slice(0, 8)}`;
  const types = await api<{ content: PresentationType[] }>(page, '/presentation-types');
  const baseType = types.content.find((type) => type.isDivisible);
  const packType = types.content.find((type) => type.code === 'PACK' && type.id !== baseType?.id);
  expect(baseType, 'An existing divisible base presentation type is required').toBeTruthy();
  expect(packType, 'An active PACK presentation type is required').toBeTruthy();

  const created = await api<{ id: number; name: string }>(page, '/products', 'POST', {
    name: `${prefix}-fifo`,
    sku: `${prefix}-fifo`,
    active: true,
    type: 'STANDARD',
    stock: INITIAL_QUANTITY,
    basePresentation: {
      presentationTypeId: baseType!.id,
      conversionFactor: 1,
      price: 10,
      cost: INITIAL_UNIT_COST,
      taxRate: 0,
      active: true,
      isBasePresentation: true,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: true,
    },
  });

  const presentations = await api<Presentation[]>(
    page,
    `/product-presentations?productId=${created.id}`
  );
  const basePresentation = presentations.find((presentation) => presentation.isBasePresentation);
  expect(
    basePresentation,
    'The newly created product must expose its base presentation'
  ).toBeTruthy();
  expect(
    basePresentation!.presentationTypeName,
    'The base presentation name is required for the purchase UI'
  ).toBeTruthy();

  const pack = await api<Presentation>(
    page,
    `/product-presentations?productId=${created.id}`,
    'POST',
    {
      productId: created.id,
      presentationTypeId: packType!.id,
      conversionFactor: FACTOR,
      price: ORIGINAL_PRICE,
      cost: INITIAL_UNIT_COST * FACTOR,
      taxRate: 0,
      barcode: `${created.name}-factor-${FACTOR}`,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: true,
    }
  );
  expect(Number(pack.conversionFactor)).toBe(FACTOR);

  const balances = await api<StockBalance[]>(page, '/inventory/stock-balance/all');
  const ownedBalances = balances.filter((balance) => balance.skuId === created.id);
  expect(ownedBalances, 'The owned product must have one initial stock balance').toHaveLength(1);
  expect(Number(ownedBalances[0].onHandQty)).toBe(INITIAL_QUANTITY);

  const warehouses = await api<Warehouse[]>(page, '/inventory/warehouses');
  const warehouse = warehouses.find(
    (candidate) => candidate.id === ownedBalances[0].warehouseId && candidate.active
  );
  expect(warehouse, 'The initial stock must belong to an active warehouse').toBeTruthy();

  const supplierPayload = await api<Supplier[] | { content?: Supplier[] }>(
    page,
    '/inventory/suppliers?page=0&size=50&sort=createdAt,desc'
  );
  const suppliers = Array.isArray(supplierPayload)
    ? supplierPayload
    : (supplierPayload.content ?? []);
  const supplier = suppliers.find((candidate) => candidate.active !== false);
  expect(supplier, 'An active supplier is required to receive the second FIFO lot').toBeTruthy();

  const methods = await api<PaymentMethod[]>(page, '/payment-methods');
  const cash = methods.find(
    (method) => method.active && method.type === 'CASH' && method.currency === 'NIO'
  );
  expect(cash, 'An active NIO CASH method is required for sale and return UI flows').toBeTruthy();

  return {
    prefix,
    item: {
      id: created.id,
      name: created.name,
      presentation: pack,
    },
    basePresentation: basePresentation!,
    warehouse: warehouse!,
    supplier: supplier!,
    cash: cash!,
  };
}

async function stockInWarehouse(
  page: Page,
  productId: number,
  warehouseId: number
): Promise<number> {
  const balances = await api<StockBalance[]>(page, '/inventory/stock-balance/all');
  return Number(
    balances.find((balance) => balance.skuId === productId && balance.warehouseId === warehouseId)
      ?.onHandQty ?? 0
  );
}

function expectedCash(shift: Shift, paymentMethodId: number): number {
  const reconciliation = shift.paymentReconciliations.find(
    (entry) => entry.paymentMethodId === paymentMethodId
  );
  expect(reconciliation, `Shift must reconcile payment method ${paymentMethodId}`).toBeTruthy();
  return Number(reconciliation!.expectedAmount);
}

async function activeShift(page: Page): Promise<Shift> {
  const shift = await api<Shift>(page, '/shifts/active?includeExpectations=true');
  expect(shift.status).toBe('OPEN');
  return shift;
}

async function createSaleThroughPos(
  page: Page,
  fixture: OwnedFixture,
  quantity: number,
  total: number
): Promise<Sale> {
  const [catalogResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/product-presentations/active'
    ),
    page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' }),
  ]);
  expect(catalogResponse.ok(), 'The POS presentation catalog must load successfully').toBe(true);
  const catalog = (await catalogResponse.json()) as Presentation[];
  expect(
    catalog.some((presentation) => presentation.id === fixture.item.presentation.id),
    'The browser catalog must include the newly created presentation before searching'
  ).toBe(true);
  await page.locator('select[name="saleWarehouse"]').selectOption(String(fixture.warehouse.id));
  await addFractional(page, fixture.item, String(quantity));
  await expect(page.getByTestId('pos-cart-total')).toContainText(total.toFixed(2));
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
  await page.getByTestId('payment-method-select').selectOption(fixture.cash.code);
  await page.getByTestId('payment-amount-input').fill(total.toFixed(2));

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sales'
  );
  await page.getByTestId('pm-finalize').click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as Sale;
  const persisted = await api<Sale>(page, `/sales/${created.id}`);
  expect(persisted.status).toBe('COMPLETED');
  expect(Number(persisted.total)).toBeCloseTo(total, 2);
  expect(persisted.lines).toHaveLength(1);
  expect(Number(persisted.lines[0].quantity)).toBe(quantity);
  expect(Number(persisted.lines[0].presentationPrice)).toBeCloseTo(
    Number(fixture.item.presentation.price),
    2
  );
  await expect(page.getByTestId('invoice-dialog')).toBeVisible();
  await page.getByTestId('invoice-close').click();
  return persisted;
}

async function returnThroughUi(
  page: Page,
  fixture: OwnedFixture,
  sale: Sale,
  customerName: string,
  quantity: number,
  expectedAlreadyReturned: number,
  expectedRemaining: number
): Promise<ReturnRecord> {
  const saleLine = sale.lines[0];
  await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-return-open-create').click();
  await page.getByTestId('customer-return-customer-search').click();
  await page.getByRole('listbox').waitFor({ state: 'visible' });
  await page
    .getByRole('option', { name: new RegExp(customerName.substring(0, 15)) })
    .first()
    .click();

  await page.getByTestId('customer-return-sale-search').click();
  const remainingResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/returns/sales/${sale.id}/remaining-quantities`
  );
  await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();
  const remainingResponse = await remainingResponsePromise;
  expect(remainingResponse.status(), await remainingResponse.text()).toBe(200);
  const remainingRows = (await remainingResponse.json()) as RemainingQuantity[];
  expect(remainingRows).toEqual([
    {
      saleLineId: saleLine.id,
      soldQuantity: ORIGINAL_QUANTITY,
      returnedQuantity: expectedAlreadyReturned,
      remainingQuantity: expectedRemaining,
    },
  ]);

  await page
    .getByTestId('customer-return-warehouse-select')
    .selectOption(String(fixture.warehouse.id));
  await page.getByTestId('customer-return-continue').click();
  const quantityInput = page.getByTestId(
    `customer-return-qty-${saleLine.productId}:${saleLine.presentationId}`
  );
  const cells = quantityInput.locator('xpath=ancestor::tr').getByRole('cell');
  await expect(cells.nth(2)).toHaveText(String(ORIGINAL_QUANTITY));
  await expect(cells.nth(3)).toHaveText(String(expectedAlreadyReturned));
  await expect(cells.nth(4)).toHaveText(String(expectedRemaining));
  await quantityInput.fill(String(quantity));
  await page
    .getByTestId('customer-return-refund-payment-method-select')
    .selectOption(String(fixture.cash.id));

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/returns'
  );
  await page.getByTestId('customer-return-submit').click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(200);
  const returned = (await response.json()) as ReturnRecord;
  expect(returned).toMatchObject({
    saleId: sale.id,
    status: 'POSTED',
    refundPaymentMethodId: fixture.cash.id,
  });
  expectMoney(
    Number(returned.totalRefunded),
    quantity * ORIGINAL_PRICE,
    'Frozen sale-price refund'
  );
  await expect(page.getByTestId('customer-return-submit')).toBeHidden();

  const savedReturns = await api<{ content: ReturnRecord[] }>(
    page,
    `/returns?search=${returned.id}&page=0&size=100`
  );
  expect(savedReturns.content.find((entry) => entry.id === returned.id)).toMatchObject({
    id: returned.id,
    saleId: sale.id,
    status: 'POSTED',
    totalRefunded: returned.totalRefunded,
  });
  const remainingAfter = await api<RemainingQuantity[]>(
    page,
    `/returns/sales/${sale.id}/remaining-quantities`
  );
  expect(remainingAfter).toEqual([
    {
      saleLineId: saleLine.id,
      soldQuantity: ORIGINAL_QUANTITY,
      returnedQuantity: expectedAlreadyReturned + quantity,
      remainingQuantity: expectedRemaining - quantity,
    },
  ]);
  return returned;
}

async function profitReportForSaleDate(page: Page, issuedAt: string): Promise<ProfitReport> {
  const date = dateInReportZone(issuedAt);
  const query = new URLSearchParams({
    startDate: date,
    endDate: date,
    timeZone: REPORT_TIME_ZONE,
  });
  return api<ProfitReport>(page, `/reports/profit?${query.toString()}`);
}

function reportRows(report: ProfitReport, saleIds: number[]): ProfitSaleRow[] {
  const rows = saleIds.map((saleId) => report.sales.find((row) => row.saleId === saleId));
  expect(
    rows.filter((row) => row === undefined),
    'Every owned sale must be present in the persisted profit report'
  ).toHaveLength(0);
  return rows.filter((row): row is ProfitSaleRow => row !== undefined);
}

function sumField(rows: ProfitSaleRow[], field: 'netSales' | 'costOfGoodsSold' | 'grossProfit') {
  return rows.reduce((total, row) => total + Number(row[field]), 0);
}

async function captureStep(
  page: Page,
  fixture: OwnedFixture,
  saleIds: number[],
  issuedAt: string,
  expectedStock: number,
  expectedReport: { netSales: number; cost: number; grossProfit: number },
  measurements: Measurement[]
): Promise<ProfitSaleRow[]> {
  const stock = await stockInWarehouse(page, fixture.item.id, fixture.warehouse.id);
  expect(stock, `${fixture.prefix}: base-unit stock after lifecycle step`).toBe(expectedStock);

  const report = await profitReportForSaleDate(page, issuedAt);
  const rows = reportRows(report, saleIds);
  for (const row of rows) {
    expect(row.costStatus, `Sale ${row.saleId} return/FIFO cost verification`).toBe('AVAILABLE');
  }
  const netSales = sumField(rows, 'netSales');
  const cost = sumField(rows, 'costOfGoodsSold');
  const grossProfit = sumField(rows, 'grossProfit');
  expectMoney(netSales, expectedReport.netSales, 'Owned-sale net revenue');
  expectMoney(cost, expectedReport.cost, 'Owned-sale cost of goods sold');
  expectMoney(grossProfit, expectedReport.grossProfit, 'Owned-sale gross profit');

  const impliedStockValuation = TOTAL_SOURCE_COST - cost;
  measurements.push({
    step: saleIds.length === 1 ? `sale-${saleIds[0]}` : `sales-${saleIds.join('-')}`,
    stockBaseUnits: stock,
    reportNetSales: netSales,
    reportCostOfGoodsSold: cost,
    reportGrossProfit: grossProfit,
    impliedStockValuation,
    costStatuses: rows.map((row) => row.costStatus),
  });
  return rows;
}

test('@serial @pos @returns ordinary multi-lot returns preserve FIFO cost through resale and profit reporting', async ({
  page,
}) => {
  const verifyTarget = await configuredMutationPreflight(page);

  const startingShift = await activeShift(page);
  await assertShiftOwner(page, startingShift);
  const fixture = await createOwnedFixture(page);
  const initialCash = expectedCash(startingShift, fixture.cash.id);
  const measurements: Measurement[] = [];

  const purchaseCandidate: PurchasePresentationCandidate = {
    supplierId: fixture.supplier.id,
    supplierName: fixture.supplier.name,
    productId: fixture.item.id,
    productName: fixture.item.name,
    presentationId: fixture.basePresentation.id,
    presentationName: fixture.basePresentation.presentationTypeName!,
    conversionFactor: Number(fixture.basePresentation.conversionFactor),
  };
  const purchase = await createPurchaseWithPresentation(
    page,
    purchaseCandidate,
    String(PURCHASE_UNIT_COST),
    String(PURCHASE_QUANTITY),
    fixture.warehouse.name
  );
  expect(purchase.id, 'The second independently costed FIFO lot must be persisted').toBeGreaterThan(
    0
  );
  expect(await stockInWarehouse(page, fixture.item.id, fixture.warehouse.id)).toBe(
    INITIAL_QUANTITY + PURCHASE_QUANTITY
  );

  const sourceSale = await createSaleThroughPos(page, fixture, ORIGINAL_QUANTITY, 500);
  const sourceLine = sourceSale.lines[0];
  expect(sourceLine.productId).toBe(fixture.item.id);
  expect(sourceLine.presentationId).toBe(fixture.item.presentation.id);
  const customer = await api<{ id: number; name: string }>(
    page,
    `/customers/${sourceSale.customerId}`
  );
  const saleCash = await activeShift(page);
  expect(saleCash.id).toBe(startingShift.id);
  expectMoney(
    expectedCash(saleCash, fixture.cash.id),
    initialCash + 500,
    'Cash sales payment must increase the open shift expectation'
  );
  const saleReport = await profitReportForSaleDate(page, sourceSale.createdAt);
  const sourceRow = reportRows(saleReport, [sourceSale.id])[0];
  expect(sourceRow).toMatchObject({ costStatus: 'AVAILABLE' });
  expectMoney(Number(sourceRow.netSales), 500, 'Original sale revenue');
  expectMoney(Number(sourceRow.costOfGoodsSold), TOTAL_SOURCE_COST, 'Two-lot outbound FIFO cost');
  expectMoney(Number(sourceRow.grossProfit), 275.9988, 'Original sale gross profit');
  await captureStep(
    page,
    fixture,
    [sourceSale.id],
    sourceSale.createdAt,
    0,
    { netSales: 500, cost: TOTAL_SOURCE_COST, grossProfit: 275.9988 },
    measurements
  );

  await api(page, `/product-presentations/${fixture.item.presentation.id}`, 'PUT', {
    ...fixture.item.presentation,
    price: UPDATED_PRICE,
  });
  fixture.item.presentation.price = UPDATED_PRICE;
  const firstReturn = await returnThroughUi(
    page,
    fixture,
    sourceSale,
    customer.name,
    3,
    0,
    ORIGINAL_QUANTITY
  );
  expectMoney(Number(firstReturn.totalRefunded), 300, 'First return refund');
  const firstReturnShift = await activeShift(page);
  expect(firstReturnShift.id).toBe(startingShift.id);
  expectMoney(
    expectedCash(firstReturnShift, fixture.cash.id),
    initialCash + 500 - 300,
    'Cash return must reduce the shift expectation by the frozen original-price refund'
  );
  await captureStep(
    page,
    fixture,
    [sourceSale.id],
    sourceSale.createdAt,
    12,
    { netSales: 200, cost: 96.0008, grossProfit: 103.9992 },
    measurements
  );

  const secondReturn = await returnThroughUi(page, fixture, sourceSale, customer.name, 2, 3, 2);
  expectMoney(Number(secondReturn.totalRefunded), 200, 'Second return refund');
  const secondReturnShift = await activeShift(page);
  expect(secondReturnShift.id).toBe(startingShift.id);
  expectMoney(
    expectedCash(secondReturnShift, fixture.cash.id),
    initialCash,
    'Full return must reverse exactly the original cash receipt'
  );
  await captureStep(
    page,
    fixture,
    [sourceSale.id],
    sourceSale.createdAt,
    20,
    { netSales: 0, cost: 0, grossProfit: 0 },
    measurements
  );

  const firstResale = await createSaleThroughPos(page, fixture, 3, 360);
  expectMoney(
    Number(firstResale.lines[0].presentationPrice),
    UPDATED_PRICE,
    'Current catalog price'
  );
  expect(await stockInWarehouse(page, fixture.item.id, fixture.warehouse.id)).toBe(8);
  const firstResaleRows = await captureStep(
    page,
    fixture,
    [sourceSale.id, firstResale.id],
    sourceSale.createdAt,
    8,
    { netSales: 360, cost: 128.0004, grossProfit: 231.9996 },
    measurements
  );
  const firstResaleRow = firstResaleRows.find((row) => row.saleId === firstResale.id);
  expect(firstResaleRow).toBeTruthy();
  expectMoney(
    Number(firstResaleRow!.costOfGoodsSold),
    128.0004,
    'Resale of 12 restored base units must consume 8 at 10 and 4 at 12.0001'
  );

  const secondResale = await createSaleThroughPos(page, fixture, 2, 240);
  const finalRows = await captureStep(
    page,
    fixture,
    [sourceSale.id, firstResale.id, secondResale.id],
    sourceSale.createdAt,
    0,
    { netSales: 600, cost: TOTAL_SOURCE_COST, grossProfit: 375.9988 },
    measurements
  );
  const secondResaleRow = finalRows.find((row) => row.saleId === secondResale.id);
  expect(secondResaleRow).toBeTruthy();
  expectMoney(
    Number(secondResaleRow!.costOfGoodsSold),
    96.0008,
    'Resale of the remaining 8 base units must retain the second lot cost'
  );

  const finalShift = await activeShift(page);
  expect(finalShift.id).toBe(startingShift.id);
  expectMoney(
    expectedCash(finalShift, fixture.cash.id),
    initialCash + 600,
    'Net shift cash must equal the two resale payments after original sale and full refund'
  );
  expectMoney(
    sumField(finalRows, 'netSales'),
    600,
    'Profit report must exclude the fully refunded original sale'
  );
  expectMoney(
    sumField(finalRows, 'costOfGoodsSold'),
    TOTAL_SOURCE_COST,
    'Re-sale COGS must conserve both original FIFO acquisition lots'
  );

  await test.info().attach('ordinary-return-fifo-measurements.json', {
    body: JSON.stringify(
      {
        fixture: fixture.prefix,
        purchaseReceiptId: purchase.id,
        sourceSaleId: sourceSale.id,
        returns: [
          { id: firstReturn.id, quantity: 3, refund: Number(firstReturn.totalRefunded) },
          { id: secondReturn.id, quantity: 2, refund: Number(secondReturn.totalRefunded) },
        ],
        resaleSaleIds: [firstResale.id, secondResale.id],
        sourceCost: TOTAL_SOURCE_COST,
        measurements,
        stockValuationEvidence:
          'Implied from the original FIFO source cost minus API-reported COGS; no per-batch valuation endpoint is exposed.',
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  verifyTarget();
});

async function setTicketLineQuantity(
  page: Page,
  lineName: string,
  quantity: string
): Promise<void> {
  const line = page.getByTestId('ticket-line').filter({ hasText: lineName });
  await line.getByRole('button', { name: /^Editar la cantidad de/ }).click();
  const input = line.getByRole('textbox', { name: `Cantidad de ${lineName}` });
  await input.fill(quantity);
  await input.press('Enter');
  await expect(input).toBeHidden();
}

async function mixedSaleThroughPos(
  page: Page,
  fixture: ComboFixture,
  comboName: string,
  basePresentationName: string,
  cashCode: string
): Promise<Sale> {
  await openPos(page, fixture);
  await page.locator('select[name="saleWarehouse"]').selectOption(String(fixture.warehouse.id));
  await addExactItem(page, fixture.physical.name, basePresentationName);
  await setTicketLineQuantity(page, fixture.physical.name, '3');
  await addExactItem(page, comboName);
  await setTicketLineQuantity(page, comboName, '1');
  await expect(page.getByTestId('pos-cart-total')).toContainText('120.00');
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
  await page.getByTestId('payment-method-select').selectOption(cashCode);
  await page.getByTestId('payment-amount-input').fill('120.00');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sales'
  );
  await page.getByTestId('pm-finalize').click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as Sale;
  const persisted = await api<Sale>(page, `/sales/${created.id}`);
  expect(persisted.status).toBe('COMPLETED');
  expect(Number(persisted.total)).toBeCloseTo(120, 2);
  expect(persisted.lines).toHaveLength(2);
  expect(persisted.lines.find((line) => line.productId === fixture.physical.id)?.quantity).toBe(3);
  expect(persisted.lines.find((line) => line.productId !== fixture.physical.id)?.quantity).toBe(1);
  await page.getByTestId('invoice-close').click();
  return persisted;
}

test('@serial @pos @returns ordinary return restores only its source cost in a mixed combo sale', async ({
  page,
}) => {
  const verifyTarget = await configuredMutationPreflight(page);
  const startingShift = await activeShift(page);
  await assertShiftOwner(page, startingShift);

  const fixture = await seedFixture(page, 4);
  const presentationResponse = await api<Presentation[]>(
    page,
    `/product-presentations?productId=${fixture.physical.id}`
  );
  const basePresentation = presentationResponse.find(
    (presentation) => presentation.isBasePresentation
  );
  expect(
    basePresentation?.presentationTypeName,
    'The physical base unit name is required'
  ).toBeTruthy();

  const supplier = await firstActiveSupplier(page);
  const purchaseCandidate: PurchasePresentationCandidate = {
    supplierId: supplier!.id,
    supplierName: supplier!.name,
    productId: fixture.physical.id,
    productName: fixture.physical.name,
    presentationId: basePresentation!.id,
    presentationName: basePresentation!.presentationTypeName!,
    conversionFactor: Number(basePresentation!.conversionFactor),
  };
  const purchase = await createPurchaseWithPresentation(
    page,
    purchaseCandidate,
    '3',
    '6',
    fixture.warehouse.name
  );
  expect(purchase.id).toBeGreaterThan(0);
  await expect(stockInWarehouse(page, fixture.physical.id, fixture.warehouse.id)).resolves.toBe(10);

  const combo = await createComboUi(page, fixture);
  const cashMethods = await api<PaymentMethod[]>(page, '/payment-methods');
  const cash = cashMethods.find(
    (method) => method.active && method.type === 'CASH' && method.currency === 'NIO'
  );
  expect(cash, 'An active NIO CASH method is required').toBeTruthy();
  const initialCash = expectedCash(startingShift, cash!.id);
  const sale = await mixedSaleThroughPos(
    page,
    fixture,
    combo.product.name,
    basePresentation!.presentationTypeName!,
    cash!.code
  );
  const ordinaryLine = sale.lines.find((line) => line.productId === fixture.physical.id);
  const comboLine = sale.lines.find((line) => line.productId === combo.product.id);
  expect(
    ordinaryLine,
    'The ordinary product line must persist separately from the combo'
  ).toBeTruthy();
  expect(
    comboLine,
    'The combo line must persist separately from the ordinary product'
  ).toBeTruthy();
  expect(await stockInWarehouse(page, fixture.physical.id, fixture.warehouse.id)).toBe(1);

  const reportBeforeReturn = await profitReportForSaleDate(page, sale.createdAt);
  const originalRow = reportRows(reportBeforeReturn, [sale.id])[0];
  expect(originalRow.costStatus).toBe('AVAILABLE');
  expectMoney(
    Number(originalRow.costOfGoodsSold),
    23,
    'Ordinary and combo allocations use 4@2 + 5@3'
  );
  expectMoney(Number(originalRow.netSales), 120, 'Mixed sale revenue before the ordinary return');

  const saleCustomer = await api<{ id: number; name: string }>(
    page,
    `/customers/${sale.customerId}`
  );
  await page.goto('/sales/returns?lng=es', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('customer-return-open-create').click();
  await page.getByTestId('customer-return-customer-search').click();
  await page.getByRole('listbox').waitFor({ state: 'visible' });
  await page
    .getByRole('option', { name: new RegExp(saleCustomer.name.substring(0, 15)) })
    .first()
    .click();
  await page.getByTestId('customer-return-sale-search').click();
  const remainingResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/returns/sales/${sale.id}/remaining-quantities`
  );
  await page.getByRole('option', { name: new RegExp(`#${sale.id}\\b`) }).click();
  const remainingResponse = await remainingResponsePromise;
  expect(remainingResponse.status(), await remainingResponse.text()).toBe(200);
  const remainingBefore = (await remainingResponse.json()) as RemainingQuantity[];
  expect(remainingBefore).toEqual(
    expect.arrayContaining([
      {
        saleLineId: ordinaryLine!.id,
        soldQuantity: 3,
        returnedQuantity: 0,
        remainingQuantity: 3,
      },
      {
        saleLineId: comboLine!.id,
        soldQuantity: 1,
        returnedQuantity: 0,
        remainingQuantity: 1,
      },
    ])
  );
  await page
    .getByTestId('customer-return-warehouse-select')
    .selectOption(String(fixture.warehouse.id));
  await page.getByTestId('customer-return-continue').click();
  const ordinaryQuantity = page.getByTestId(
    `customer-return-qty-${ordinaryLine!.productId}:${ordinaryLine!.presentationId}`
  );
  await ordinaryQuantity.fill('3');
  await page
    .getByTestId('customer-return-refund-payment-method-select')
    .selectOption(String(cash!.id));
  const returnResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/returns'
  );
  await page.getByTestId('customer-return-submit').click();
  const returnResponse = await returnResponsePromise;
  expect(returnResponse.status(), await returnResponse.text()).toBe(200);
  const returned = (await returnResponse.json()) as ReturnRecord;
  expect(returned).toMatchObject({
    saleId: sale.id,
    status: 'POSTED',
    refundPaymentMethodId: cash!.id,
  });
  expectMoney(
    Number(returned.totalRefunded),
    30,
    'Ordinary line refund uses its frozen sale price'
  );
  expect(await stockInWarehouse(page, fixture.physical.id, fixture.warehouse.id)).toBe(4);

  const remainingAfter = await api<RemainingQuantity[]>(
    page,
    `/returns/sales/${sale.id}/remaining-quantities`
  );
  expect(remainingAfter).toEqual(
    expect.arrayContaining([
      {
        saleLineId: ordinaryLine!.id,
        soldQuantity: 3,
        returnedQuantity: 3,
        remainingQuantity: 0,
      },
      {
        saleLineId: comboLine!.id,
        soldQuantity: 1,
        returnedQuantity: 0,
        remainingQuantity: 1,
      },
    ])
  );
  const reportAfterReturn = await profitReportForSaleDate(page, sale.createdAt);
  const returnedSaleRow = reportRows(reportAfterReturn, [sale.id])[0];
  expect(returnedSaleRow.costStatus).toBe('AVAILABLE');
  expectMoney(Number(returnedSaleRow.netSales), 90, 'Only the ordinary sale revenue is refunded');
  expectMoney(
    Number(returnedSaleRow.costOfGoodsSold),
    17,
    'Only the ordinary 3@2 cost is restored'
  );
  expectMoney(Number(returnedSaleRow.grossProfit), 73, 'Mixed sale net gross profit after return');
  expectMoney(
    Number(originalRow.costOfGoodsSold) - Number(returnedSaleRow.costOfGoodsSold),
    6,
    'The returned ordinary source cost remains distinct from combo COGS'
  );
  const finalShift = await activeShift(page);
  expect(finalShift.id).toBe(startingShift.id);
  expectMoney(
    expectedCash(finalShift, cash!.id),
    initialCash + 90,
    'Mixed sale and ordinary refund must reconcile to their net shift cash'
  );

  await test.info().attach('ordinary-return-mixed-sale-measurements.json', {
    body: JSON.stringify(
      {
        fixture: fixture.prefix,
        purchaseReceiptId: purchase.id,
        saleId: sale.id,
        ordinarySaleLineId: ordinaryLine!.id,
        comboSaleLineId: comboLine!.id,
        returnId: returned.id,
        sourceBatches: [
          { quantity: 4, unitCost: 2 },
          { quantity: 6, unitCost: 3 },
        ],
        sourceCost: MIXED_SOURCE_COST,
        reportedOriginalSaleCost: 23,
        reportedCostAfterOrdinaryReturn: Number(returnedSaleRow.costOfGoodsSold),
        stockAfterSale: 1,
        stockAfterReturn: 4,
        costStatus: returnedSaleRow.costStatus,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
  verifyTarget();
});
