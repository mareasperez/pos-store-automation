import { expect, test, type Page } from '@playwright/test';
import { config } from '@config';

type CreatedProductResponse = {
  id: number;
  name: string;
  sku: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createProductWithInitialStock(
  page: Page,
  productName: string,
  productSku: string,
  initialStock: string
): Promise<CreatedProductResponse> {
  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(productName);
  await page.locator('input[name="sku"]').fill(productSku);

  const stockInput = page.locator('input[name="stock"]');
  await expect(stockInput).toBeVisible({ timeout: 20_000 });
  await stockInput.fill(initialStock);

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/products')
  );

  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);

  return (await createResponse.json()) as CreatedProductResponse;
}

async function assertProductVisibleInCatalog(page: Page, createdProduct: CreatedProductResponse) {
  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])/i, { timeout: 20_000 });

  const catalogSearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(catalogSearch).toBeVisible({ timeout: 20_000 });
  await catalogSearch.fill(createdProduct.name);

  const productRow = page
    .getByRole('row', {
      name: new RegExp(
        `${escapeRegExp(createdProduct.name)}|${escapeRegExp(createdProduct.sku)}`,
        'i'
      ),
    })
    .first();

  await expect(productRow).toBeVisible({ timeout: 20_000 });
}

async function assertProductVisibleInInventory(page: Page, createdProduct: CreatedProductResponse) {
  await page.goto('/inventory/products', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/products(?:$|[?#])/i, { timeout: 20_000 });

  const inventorySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(inventorySearch).toBeVisible({ timeout: 20_000 });
  await inventorySearch.fill(createdProduct.name);

  const inventoryMatch = page
    .locator('main')
    .getByText(new RegExp(`${escapeRegExp(createdProduct.name)}|${escapeRegExp(createdProduct.sku)}`, 'i'))
    .first();
  await expect(inventoryMatch).toBeVisible({ timeout: 20_000 });
}

function requireCredentialsOrSkip() {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run product creation flows.'
  );
}

test('@manual @catalog @products creates a standard product and shows it in catalog', async ({ page }) => {
  requireCredentialsOrSkip();

  const suffix = Date.now();
  const productName = `E2E Product Catalog ${suffix}`;
  const productSku = `E2E-${suffix}`;
  const initialStock = '7';

  const createdProduct = await createProductWithInitialStock(
    page,
    productName,
    productSku,
    initialStock
  );

  await assertProductVisibleInCatalog(page, createdProduct);
});

test('@manual @inventory @products creates a standard product and shows it in inventory', async ({ page }) => {
  requireCredentialsOrSkip();

  const suffix = Date.now();
  const productName = `E2E Product Inventory ${suffix}`;
  const productSku = `E2E-${suffix}`;
  const initialStock = '7';

  const createdProduct = await createProductWithInitialStock(
    page,
    productName,
    productSku,
    initialStock
  );

  await assertProductVisibleInInventory(page, createdProduct);
});