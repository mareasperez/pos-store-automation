import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { config } from '@config';
import { buildUniqueTestToken } from '../../../services/uniqueData';
import { expectResponseOk } from '../../../support/flows/apiAssertions';
import { requireCredentialsOrSkip } from '../../../support/flows/auth.flow';
type ExistingSupplier = {
  id: number;
  name: string;
  active?: boolean;
  paymentTerm?: string;
};

type ExistingProduct = {
  id: number;
  name: string;
  active?: boolean;
  type?: 'STANDARD' | 'SERVICE' | 'GENERIC';
  preferredSupplierId?: number | null;
};

type CompatiblePurchasePair = {
  supplierId?: number;
  supplierName: string;
  productId?: number;
  productName: string;
};

type PurchaseRequestPayload = {
  allowPreferredSupplierOverride?: boolean;
  paymentTerm?: 'IMMEDIATE' | 'CREDIT';
};

type PurchaseReceipt = {
  id?: number;
  invoiceRef?: string | null;
  purchaseOrderRef?: string | null;
};

type ApiRequestResult = {
  ok: boolean;
  payload: unknown;
  attemptedUrls: string[];
  attemptedStatuses: string[];
};

type ExistingDataResult =
  | {
      ok: true;
      suppliers: ExistingSupplier[];
      products: ExistingProduct[];
    }
  | {
      ok: false;
      reason: string;
    };

type PairResolution = {
  pair: CompatiblePurchasePair | null;
  reason: string;
};

async function buildApiAuthHeaders(page: Page): Promise<Record<string, string>> {
  const storageState = await page.context().storageState();
  const accessToken = storageState.cookies.find((cookie) => cookie.name === 'access_token')?.value;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    headers.Cookie = `access_token=${accessToken}`;
  }

  if (config.tenantId) {
    headers['X-Tenant-Id'] = config.tenantId;
  }

  return headers;
}

function skipWithReason(condition: boolean, reason: string) {
  if (condition) {
    console.warn(`[E2E][SKIP] ${reason}`);
  }

  test.skip(condition, reason);
}

async function selectSupplier(page: Page, supplierName: string) {
  const supplierInput = page.getByTestId('purchase-supplier-input');
  await expect(supplierInput).toBeVisible({ timeout: 20_000 });
  // Wait for the supplier list to finish loading (placeholder changes from 'Cargando...')
  await expect(supplierInput).not.toHaveAttribute('placeholder', /cargando/i, { timeout: 15_000 });
  await supplierInput.click();
  // Confirm dropdown has items before typing
  await expect(page.locator('[data-slot="combobox-item"]').first()).toBeVisible({ timeout: 10_000 });
  const visibleItems = await page.locator('[data-slot="combobox-item"]').allTextContents();
  console.log(`[selectSupplier] ${visibleItems.length} items loaded:`, visibleItems);
  await supplierInput.pressSequentially(supplierName, { delay: 40 });
  const option = page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: supplierName })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

async function addPurchaseLine(page: Page, productName: string, unitCost: string) {
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.fill(productName);

  await page.getByRole('option', { name: new RegExp(productName, 'i') }).first().click();

  const lineRow = page.locator('tbody tr', { hasText: productName }).first();
  await expect(lineRow).toBeVisible({ timeout: 20_000 });

  await fillPurchaseLineUnitCost(page, lineRow, productSearchInput, unitCost);
}

async function getTableColumnIndex(table: Locator, headerName: RegExp): Promise<number> {
  const headers = table.locator('thead th');
  const count = await headers.count();

  for (let index = 0; index < count; index += 1) {
    const headerText = (await headers.nth(index).innerText()).trim();
    if (headerName.test(headerText)) {
      return index;
    }
  }

  throw new Error(`Column header not found: ${headerName}`);
}

async function fillPurchaseLineUnitCost(
  page: Page,
  lineRow: Locator,
  productSearchInput: Locator,
  unitCost: string
) {
  const table = lineRow.locator('xpath=ancestor::table[1]');
  const quantityColumnIndex = await getTableColumnIndex(table, /cantidad|quantity/i);
  const unitCostColumnIndex = await getTableColumnIndex(table, /costo unit\.?|unit cost|cost/i);
  const totalColumnIndex = await getTableColumnIndex(table, /total/i);

  const cells = lineRow.locator('td');
  const quantityInput = cells.nth(quantityColumnIndex).locator('input[type="number"]');
  const unitCostInput = cells.nth(unitCostColumnIndex).locator('input[type="number"]');
  const lineTotal = cells.nth(totalColumnIndex);

  await expect(quantityInput).toHaveValue('1', { timeout: 20_000 });
  await expect(unitCostInput).toBeVisible({ timeout: 20_000 });
  await unitCostInput.fill(unitCost);
  await expect(unitCostInput).toHaveValue(unitCost, { timeout: 20_000 });
  await expect(productSearchInput).not.toHaveValue(unitCost);
  await expect(lineTotal).toContainText(moneyAmountPattern(unitCost), {
    timeout: 20_000,
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function moneyAmountPattern(amount: string): RegExp {
  return new RegExp(escapeRegex(amount).replace('\\.', '[.,]'));
}

function normalizeApiBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildApiUrlCandidates(path: string): string[] {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBase = normalizeApiBase(config.apiUrl);
  const baseWithoutApiSuffix = apiBase.endsWith('/api') ? apiBase.slice(0, -4) : apiBase;

  let candidates: string[];

  if (normalizedPath.startsWith('/api/')) {
    // For explicit /api paths, prioritize and keep the exact URL contract.
    candidates = [`${baseWithoutApiSuffix}${normalizedPath}`];
  } else {
    candidates = [`${apiBase}${normalizedPath}`, `${baseWithoutApiSuffix}/api${normalizedPath}`];
  }

  return [...new Set(candidates)];
}

async function requestApiWithFallback(page: Page, path: string): Promise<ApiRequestResult> {
  const candidates = buildApiUrlCandidates(path);
  const headers = await buildApiAuthHeaders(page);
  const attemptedUrls: string[] = [];
  const attemptedStatuses: string[] = [];

  for (const candidate of candidates) {
    attemptedUrls.push(candidate);
    const response = await page.request.get(candidate, { headers });
    attemptedStatuses.push(`${response.status()} ${response.statusText()}`);

    if (!response.ok()) {
      continue;
    }

    const payload = (await response.json()) as unknown;
    return { ok: true, payload, attemptedUrls, attemptedStatuses };
  }

  return { ok: false, payload: null, attemptedUrls, attemptedStatuses };
}

async function addPurchaseLineFromSearchModal(
  page: Page,
  productName: string,
  unitCost: string,
  options?: { showAllProducts?: boolean }
) {
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.click();
  await productSearchInput.press('Enter');

  const modalSearchInput = page
    .getByPlaceholder(/nombre, c[oó]digo o barcode|name, code or barcode/i)
    .first();
  await expect(modalSearchInput).toBeVisible({ timeout: 20_000 });

  if (options?.showAllProducts) {
    const showAllCheckbox = page
      .getByRole('checkbox', { name: /mostrar todos los productos|show all products/i })
      .first();
    await expect(showAllCheckbox).toBeVisible({ timeout: 20_000 });
    await showAllCheckbox.check();
  }

  await modalSearchInput.fill(productName);
  await page
    .getByRole('button', { name: new RegExp(escapeRegex(productName), 'i') })
    .first()
    .click();

  const lineRow = page.locator('tbody tr', { hasText: productName }).first();
  await expect(lineRow).toBeVisible({ timeout: 20_000 });
  await fillPurchaseLineUnitCost(page, lineRow, productSearchInput, unitCost);
}

async function confirmPurchase(page: Page): Promise<PurchaseRequestPayload> {
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/api/inventory/purchase-receipts')
  );

  await page.getByRole('button', { name: /comprar|purchase/i }).click();
  await expect(page.getByText(/confirmar compra|confirm purchase/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /confirmar|confirm/i }).last().click();

  const createResponse = await createResponsePromise;
  await expectResponseOk(createResponse, 'Purchase receipt create response');

  const payload = createResponse.request().postDataJSON() as PurchaseRequestPayload;
  return payload ?? {};
}

function toSupplierArray(payload: unknown): ExistingSupplier[] {
  if (Array.isArray(payload)) {
    return payload as ExistingSupplier[];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'content' in payload &&
    Array.isArray((payload as { content?: unknown }).content)
  ) {
    return (payload as { content: ExistingSupplier[] }).content;
  }

  return [];
}

function toProductArray(payload: unknown): ExistingProduct[] {
  if (Array.isArray(payload)) {
    return payload as ExistingProduct[];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'content' in payload &&
    Array.isArray((payload as { content?: unknown }).content)
  ) {
    return (payload as { content: ExistingProduct[] }).content;
  }

  return [];
}

function toPurchaseArray(payload: unknown): PurchaseReceipt[] {
  if (Array.isArray(payload)) {
    return payload as PurchaseReceipt[];
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'content' in payload &&
    Array.isArray((payload as { content?: unknown }).content)
  ) {
    return (payload as { content: PurchaseReceipt[] }).content;
  }

  return [];
}

async function fetchPurchaseHistory(page: Page): Promise<PurchaseReceipt[]> {
  const result = await requestApiWithFallback(page, '/api/inventory/purchase-receipts');
  if (!result.ok) {
    throw new Error(
      `Purchase history API unavailable. Tried: ${result.attemptedUrls.join(' | ')}. Statuses: ${result.attemptedStatuses.join(' | ')}`
    );
  }

  return toPurchaseArray(result.payload);
}

async function waitForPurchaseHistoryToContain(page: Page, invoiceRef: string): Promise<PurchaseReceipt> {
  let matchingPurchase: PurchaseReceipt | undefined;

  await expect
    .poll(
      async () => {
        const purchases = await fetchPurchaseHistory(page);
        matchingPurchase = purchases.find((purchase) => purchase.invoiceRef === invoiceRef);
        return Boolean(matchingPurchase);
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe(true);

  if (!matchingPurchase) {
    throw new Error(`Purchase history API did not return invoiceRef: ${invoiceRef}`);
  }

  return matchingPurchase;
}

async function fetchExistingSuppliersAndProducts(page: Page): Promise<ExistingDataResult> {
  const suppliersResult = await requestApiWithFallback(
    page,
    '/api/inventory/suppliers?page=0&size=10&sort=createdAt,desc'
  );
  if (!suppliersResult.ok) {
    return {
      ok: false,
      reason: `Suppliers API unavailable. Tried: ${suppliersResult.attemptedUrls.join(' | ')}. Statuses: ${suppliersResult.attemptedStatuses.join(' | ')}`,
    };
  }

  const productsResult = await requestApiWithFallback(page, '/products');
  if (!productsResult.ok) {
    return {
      ok: false,
      reason: `Products API unavailable. Tried: ${productsResult.attemptedUrls.join(' | ')}. Statuses: ${productsResult.attemptedStatuses.join(' | ')}`,
    };
  }

  const suppliersPayload = suppliersResult.payload;
  const productsPayload = productsResult.payload;

  const suppliers = toSupplierArray(suppliersPayload).filter((supplier) =>
    supplier.active !== false
  );
  const products = toProductArray(productsPayload).filter(
    (product) => product.active !== false && product.type !== 'SERVICE'
  );

  return { ok: true, suppliers, products };
}

async function resolveCompatiblePurchasePair(page: Page): Promise<PairResolution> {
  const data = await fetchExistingSuppliersAndProducts(page);
  if (!data.ok) {
    return { pair: null, reason: data.reason };
  }

  const { suppliers, products: purchasableProducts } = data;

  for (const supplier of suppliers) {
    const compatibleProduct = purchasableProducts.find(
      (product) =>
        product.preferredSupplierId == null || product.preferredSupplierId === supplier.id
    );

    if (compatibleProduct) {
      return {
        pair: {
          supplierId: supplier.id,
          supplierName: supplier.name,
          productId: compatibleProduct.id,
          productName: compatibleProduct.name,
        },
        reason: '',
      };
    }
  }

  return {
    pair: null,
    reason: 'No compatible active supplier/product pair found in API data.',
  };
}

async function resolvePairWithoutPreferredSupplier(
  page: Page
): Promise<PairResolution> {
  const data = await fetchExistingSuppliersAndProducts(page);
  if (!data.ok) {
    return { pair: null, reason: data.reason };
  }

  const { suppliers, products } = data;
  const supplier = suppliers[0];
  if (!supplier) {
    return { pair: null, reason: 'No active suppliers found in API data.' };
  }

  const product = products.find((candidate) => candidate.preferredSupplierId == null);
  if (!product) {
    return {
      pair: null,
      reason: 'No active product without preferred supplier found in API data.',
    };
  }

  return {
    pair: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      productId: product.id,
      productName: product.name,
    },
    reason: '',
  };
}

async function resolvePairForPreferredSupplierOverride(
  page: Page
): Promise<PairResolution> {
  const data = await fetchExistingSuppliersAndProducts(page);
  if (!data.ok) {
    return { pair: null, reason: data.reason };
  }

  const { suppliers, products } = data;

  for (const product of products) {
    if (product.preferredSupplierId == null) continue;

    const alternativeSupplier = suppliers.find((supplier) => supplier.id !== product.preferredSupplierId);
    if (!alternativeSupplier) continue;

    return {
      pair: {
        supplierId: alternativeSupplier.id,
        supplierName: alternativeSupplier.name,
        productId: product.id,
        productName: product.name,
      },
      reason: '',
    };
  }

  return {
    pair: null,
    reason:
      'No mismatch pair found in API data (product with preferred supplier and alternate supplier).',
  };
}

function purchaseVisibleReference(purchase: PurchaseReceipt, invoiceRef: string): string {
  if (!purchase.purchaseOrderRef) {
    throw new Error(`Purchase ${invoiceRef} has no purchaseOrderRef for history table lookup.`);
  }

  return purchase.purchaseOrderRef;
}

function purchaseRow(page: Page, visibleReference: string): Locator {
  return page.locator('tbody tr', { hasText: visibleReference }).first();
}

async function resolveExistingCreditSupplier(page: Page): Promise<{ name: string } | null> {
  const result = await requestApiWithFallback(
    page,
    '/api/inventory/suppliers?page=0&size=50&sort=createdAt,desc'
  );
  if (!result.ok) return null;
  const suppliers = toSupplierArray(result.payload).filter(
    (s) => s.active !== false && s.paymentTerm === 'CREDIT'
  );
  return suppliers[0] ?? null;
}

async function expectPurchaseHistoryRow(
  page: Page,
  invoiceRef: string,
  expectedProductCount?: string
) {
  const purchase = await waitForPurchaseHistoryToContain(page, invoiceRef);
  const visibleReference = purchaseVisibleReference(purchase, invoiceRef);

  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(visibleReference);

  const row = purchaseRow(page, visibleReference);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(visibleReference);

  if (expectedProductCount) {
    await expect(row).toContainText(expectedProductCount);
  }
}

test('@regression @purchases @manual creates a purchase and shows it in purchase history', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('purchase creation flows');

  // Resolve an existing supplier — supplier CRUD is tested in the suppliers suite
  const { pair, reason } = await resolveCompatiblePurchasePair(page);
  skipWithReason(!pair, reason || 'No active supplier+product pair available.');

  const uniqueTag = buildUniqueTestToken(testInfo, 'PUR');
  const invoiceRef = `INV-E2E-${uniqueTag}`;
  const unitCost = '12.50';

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, pair!.supplierName);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLine(page, pair!.productName, unitCost);
  await confirmPurchase(page);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();
  await expectPurchaseHistoryRow(page, invoiceRef, '1');
});

test('@regression @purchases @manual creates a credit purchase with a credit supplier', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('purchase creation flows');

  // Needs an existing credit supplier — creation is tested in the suppliers suite
  const creditSupplier = await resolveExistingCreditSupplier(page);
  skipWithReason(!creditSupplier, 'No active credit supplier found; create one in the suppliers suite first.');

  const { pair: productPair, reason: productReason } = await resolveCompatiblePurchasePair(page);
  skipWithReason(!productPair, productReason || 'No active product available.');

  const uniqueTag = buildUniqueTestToken(testInfo, 'CR');
  const invoiceRef = `INV-CR-${uniqueTag}`;
  const unitCost = '55.50';

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, creditSupplier!.name);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLine(page, productPair!.productName, unitCost);
  const payload = await confirmPurchase(page);

  expect(payload.paymentTerm).toBe('CREDIT');

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();
  await expectPurchaseHistoryRow(page, invoiceRef);
});

test('@regression @purchases @manual creates a purchase with existing supplier and product', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('purchase creation flows');

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolveCompatiblePurchasePair(page);
  skipWithReason(!pair, reason || 'Existing-data precondition not met.');

  const invoiceRef = `INV-EXIST-${buildUniqueTestToken(testInfo, 'EX')}`;
  const unitCost = '11.25';

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, pair!.supplierName);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLine(page, pair!.productName, unitCost);
  await confirmPurchase(page);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();
  await expectPurchaseHistoryRow(page, invoiceRef);
});

test('@regression @purchases @manual creates a purchase with product without preferred supplier', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('purchase creation flows');

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolvePairWithoutPreferredSupplier(page);
  skipWithReason(!pair, reason || 'No-preferred-supplier precondition not met.');

  const selectedPair = pair as CompatiblePurchasePair;
  const invoiceRef = `INV-NOPREF-${buildUniqueTestToken(testInfo, 'NP')}`;
  const unitCost = '10.50';

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, selectedPair.supplierName);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLine(page, selectedPair.productName, unitCost);
  const payload = await confirmPurchase(page);
  expect(payload.allowPreferredSupplierOverride).not.toBe(true);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();
  await expectPurchaseHistoryRow(page, invoiceRef);
});

test('@regression @purchases @manual creates a purchase overriding preferred supplier', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('purchase creation flows');

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolvePairForPreferredSupplierOverride(page);
  skipWithReason(!pair, reason || 'Preferred-supplier-override precondition not met.');

  const selectedPair = pair as CompatiblePurchasePair;
  const invoiceRef = `INV-OVR-${buildUniqueTestToken(testInfo, 'OV')}`;
  const unitCost = '14.75';

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, selectedPair.supplierName);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLineFromSearchModal(page, selectedPair.productName, unitCost, {
    showAllProducts: true,
  });

  await expect(
    page.getByLabel(/proveedor preferido.+no coincide|preferred supplier.+does not match/i).first()
  ).toBeVisible({ timeout: 20_000 });

  const payload = await confirmPurchase(page);
  expect(payload.allowPreferredSupplierOverride).toBe(true);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();
  await expectPurchaseHistoryRow(page, invoiceRef);
});
