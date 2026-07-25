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

async function loginAsValidUser(page: Page) {
  await page.goto('/login?lng=es', { waitUntil: 'domcontentloaded' });

  await page.locator('input[name="username"]').fill(config.credentials.username);
  await page.locator('input[name="password"]').fill(config.credentials.password);
  await page.locator('button[type="submit"]').click();

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });
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

async function assertProductVisibleInInventoryWithStock(
  page: Page,
  createdProduct: CreatedProductResponse,
  initialStock: string
) {
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

  const detailButton = page.getByRole('button', { name: /detalle|detail/i }).first();
  const canOpenDetailFromTable = await detailButton.isVisible().catch(() => false);

  if (canOpenDetailFromTable) {
    await detailButton.click();
  } else {
    await inventoryMatch.click();
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toContainText(createdProduct.name);

  const totalStockValue = dialog
    .locator('p', { hasText: /total stock|stock total/i })
    .first()
    .locator('xpath=following-sibling::p[1]');

  await expect(totalStockValue).toHaveText(new RegExp(`\\b${escapeRegExp(initialStock)}\\b`));
}

test('@manual @catalog @products creates a standard product with initial stock', async ({ page }) => {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run product creation flows.'
  );

  const suffix = Date.now();
  const productName = `E2E Product ${suffix}`;
  const productSku = `E2E-${suffix}`;
  const initialStock = '7';

  await loginAsValidUser(page);

  const createdProduct = await createProductWithInitialStock(
    page,
    productName,
    productSku,
    initialStock
  );

  await assertProductVisibleInCatalog(page, createdProduct);
  await assertProductVisibleInInventoryWithStock(page, createdProduct, initialStock);
});