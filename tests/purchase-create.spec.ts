import { expect, test, type Locator, type Page } from '@playwright/test';
import { config } from '@config';
import { fakerDataService } from '../services/fakerDataService';

type ExistingSupplier = {
  id: number;
  name: string;
  active?: boolean;
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

function requireCredentialsOrSkip() {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run purchase creation flows.'
  );
}

function skipWithReason(condition: boolean, reason: string) {
  if (condition) {
    console.warn(`[E2E][SKIP] ${reason}`);
  }

  test.skip(condition, reason);
}

async function createSupplier(page: Page, seed: number) {
  const supplier = fakerDataService.buildSupplierFake(seed);

  await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/suppliers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo proveedor|new supplier/i }).click();
  await page.getByLabel(/nombre de empresa|company name/i).fill(supplier.name);
  await page.getByLabel(/nombre de contacto|contact name/i).fill(supplier.contactName);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(supplier.phone);
  await page.getByLabel(/email/i).fill(supplier.email);
  await page.getByLabel(/direcci[oó]n|address/i).fill(supplier.address);
  await page.getByRole('button', { name: /guardar|save/i }).last().click();

  await expect(page.getByText(supplier.name)).toBeVisible({ timeout: 20_000 });

  return supplier;
}

async function createPurchasableProduct(page: Page, seed: number) {
  const product = fakerDataService.buildProductFake(seed, 'standard');

  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(product.name);
  await page.locator('input[name="sku"]').fill(product.sku);
  await page.locator('input[name="stock"]').fill('0');

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/products')
  );

  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])/i, { timeout: 20_000 });

  return product;
}

async function selectSupplier(page: Page, supplierName: string) {
  const supplierInput = page.getByPlaceholder(/seleccionar proveedor|select supplier/i).first();
  await expect(supplierInput).toBeVisible({ timeout: 20_000 });
  await supplierInput.click();
  await supplierInput.fill(supplierName);
  await page.getByText(supplierName).first().click();
}

async function addPurchaseLine(page: Page, productName: string, unitCost: string) {
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.fill(productName);

  await page.getByRole('option', { name: new RegExp(productName, 'i') }).first().click();

  const lineRow = page.locator('tbody tr', { hasText: productName }).first();
  await expect(lineRow).toBeVisible({ timeout: 20_000 });

  const numberInputs = lineRow.locator('input[type="number"]');
  await numberInputs.nth(1).fill(unitCost);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const numberInputs = lineRow.locator('input[type="number"]');
  await numberInputs.nth(1).fill(unitCost);
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
  expect(createResponse.ok()).toBe(true);

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

function purchaseRow(page: Page, supplierName: string): Locator {
  return page.locator('tbody tr', { hasText: supplierName }).first();
}

test('@manual @purchases creates a purchase and shows it in purchase history', async ({ page }) => {
  requireCredentialsOrSkip();

  const seed = Date.now();
  const supplier = await createSupplier(page, seed);
  const product = await createPurchasableProduct(page, seed + 1);
  const invoiceRef = `INV-E2E-${String(seed).slice(-6)}`;
  const unitCost = '12.50';

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  await selectSupplier(page, supplier.name);
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  await addPurchaseLine(page, product.name, unitCost);
  await confirmPurchase(page);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();

  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(supplier.name);

  const row = purchaseRow(page, supplier.name);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(supplier.name);
  await expect(row).toContainText('1');
});

test('@manual @purchases @existing-data creates a purchase with existing supplier and product', async ({ page }) => {
  requireCredentialsOrSkip();

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolveCompatiblePurchasePair(page);
  skipWithReason(!pair, reason || 'Existing-data precondition not met.');

  const invoiceRef = `INV-EXIST-${String(Date.now()).slice(-6)}`;
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

  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(pair!.supplierName);

  const row = purchaseRow(page, pair!.supplierName);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(pair!.supplierName);
});

test('@manual @purchases @existing-data @no-preferred-supplier creates a purchase with product without preferred supplier', async ({ page }) => {
  requireCredentialsOrSkip();

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolvePairWithoutPreferredSupplier(page);
  skipWithReason(!pair, reason || 'No-preferred-supplier precondition not met.');

  const selectedPair = pair as CompatiblePurchasePair;
  const invoiceRef = `INV-NOPREF-${String(Date.now()).slice(-6)}`;
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

  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(selectedPair.supplierName);

  const row = purchaseRow(page, selectedPair.supplierName);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(selectedPair.supplierName);
});

test('@manual @purchases @existing-data @override-preferred-supplier creates a purchase overriding preferred supplier', async ({ page }) => {
  requireCredentialsOrSkip();

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  const { pair, reason } = await resolvePairForPreferredSupplierOverride(page);
  skipWithReason(!pair, reason || 'Preferred-supplier-override precondition not met.');

  const selectedPair = pair as CompatiblePurchasePair;
  const invoiceRef = `INV-OVR-${String(Date.now()).slice(-6)}`;
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

  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(selectedPair.supplierName);

  const row = purchaseRow(page, selectedPair.supplierName);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(selectedPair.supplierName);
});
