import { expect, test, type Page } from '@playwright/test';
import { config } from '@config';
import { expectResponseStatus } from './apiAssertions';

export type CreatedProductResponse = {
  id: number;
  name: string;
  sku: string;
  productCode?: string;
};

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function requireCredentialsOrSkip(): void {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run product flows.'
  );
}

export async function assertGeneratedProductCodeOnCreate(page: Page): Promise<void> {
  const productCodeInput = page.getByLabel(/c[oó]digo|code/i).first();
  await expect(productCodeInput).toBeDisabled({ timeout: 20_000 });
  await expect(productCodeInput).toHaveValue(/generado al guardar|generated on save/i);
}

export async function createProductWithInitialStock(
  page: Page,
  productName: string,
  productSku: string,
  initialStock: string
): Promise<CreatedProductResponse> {
  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await assertGeneratedProductCodeOnCreate(page);

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
  await expectResponseStatus(createResponse, 201, 'Product create response');

  return (await createResponse.json()) as CreatedProductResponse;
}

export async function assertProductVisibleInCatalog(
  page: Page,
  createdProduct: CreatedProductResponse
): Promise<void> {
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

export async function assertProductVisibleInInventory(
  page: Page,
  createdProduct: CreatedProductResponse
): Promise<void> {
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

export async function addPresentationInEditorModal(
  page: Page,
  conversionFactor: string,
  cost = '100',
  price = '150'
): Promise<void> {
  await page.getByRole('button', { name: /add presentation|agregar presentaci[oó]n/i }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 10_000 });

  const factorInput = modal.getByLabel(/factor|conversion factor/i);
  await expect(factorInput).toBeVisible({ timeout: 5_000 });
  await factorInput.fill(conversionFactor);

  const costInput = modal.getByLabel(/^costo$|^cost$/i);
  await costInput.fill(cost);

  const priceInput = modal.getByLabel(/^precio$|^price$/i);
  await priceInput.fill(price);

  const saveButton = modal.getByRole('button', { name: /^save$|^guardar$/i });
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  await expect(modal).not.toBeVisible({ timeout: 5_000 });
}

export async function savePresentations(page: Page): Promise<void> {
  const presentationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/product-presentations')
  );
  await page.getByRole('button', { name: /guardar presentaciones|save presentations/i }).click();
  const response = await presentationResponsePromise;
  expect(response.status()).toBeLessThan(300);
}
