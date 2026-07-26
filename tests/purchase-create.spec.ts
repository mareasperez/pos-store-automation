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
  supplierName: string;
  productName: string;
};

function requireCredentialsOrSkip() {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run purchase creation flows.'
  );
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

async function confirmPurchase(page: Page) {
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

async function resolveCompatiblePurchasePair(page: Page): Promise<CompatiblePurchasePair | null> {
  const suppliersResponse = await page.request.get('/api/inventory/suppliers?size=100&sort=createdAt,desc');
  if (!suppliersResponse.ok()) {
    return null;
  }

  const productsResponse = await page.request.get('/api/products');
  if (!productsResponse.ok()) {
    return null;
  }

  const suppliersPayload = (await suppliersResponse.json()) as unknown;
  const productsPayload = (await productsResponse.json()) as unknown;

  const suppliers = toSupplierArray(suppliersPayload).filter((supplier) =>
    supplier.active !== false
  );
  const products = (Array.isArray(productsPayload) ? productsPayload : []) as ExistingProduct[];

  const purchasableProducts = products.filter(
    (product) => product.active !== false && product.type !== 'SERVICE'
  );

  for (const supplier of suppliers) {
    const compatibleProduct = purchasableProducts.find(
      (product) =>
        product.preferredSupplierId == null || product.preferredSupplierId === supplier.id
    );

    if (compatibleProduct) {
      return {
        supplierName: supplier.name,
        productName: compatibleProduct.name,
      };
    }
  }

  return null;
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

  const pair = await resolveCompatiblePurchasePair(page);
  test.skip(!pair, 'No compatible active supplier/product pair found in API data.');

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
