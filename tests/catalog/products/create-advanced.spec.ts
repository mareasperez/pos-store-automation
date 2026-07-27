import { expect, test, type Page } from '@playwright/test';
import { fakerDataService } from '../../../services/fakerDataService';
import {
  addPresentationInEditorModal,
  escapeRegExp,
  requireCredentialsOrSkip,
  type CreatedProductResponse,
} from '../../../support/catalog/products/helpers';

async function createSupplier(page: Page, suffix: number): Promise<string> {
  const fakeSupplier = fakerDataService.buildSupplierFake(suffix);

  await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/suppliers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo proveedor|new supplier/i }).click();
  await page.getByLabel(/nombre de empresa|company name/i).fill(fakeSupplier.name);
  await page.getByLabel(/nombre de contacto|contact name/i).fill(fakeSupplier.contactName);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(fakeSupplier.phone);
  await page.getByLabel(/email/i).fill(fakeSupplier.email);
  await page.getByLabel(/direcci[oó]n|address/i).fill(fakeSupplier.address);

  await page.getByRole('button', { name: /guardar|save/i }).last().click();
  await expect(page.getByText(fakeSupplier.name)).toBeVisible({ timeout: 20_000 });

  return fakeSupplier.name;
}

async function selectPreferredSupplier(page: Page, supplierName: string) {
  const supplierTrigger = page.locator('button#preferredSupplierId');
  await expect(supplierTrigger).toBeVisible({ timeout: 20_000 });
  await supplierTrigger.click();

  const searchInput = page.getByRole('textbox', { name: /search/i }).first();
  await expect(searchInput).toBeVisible({ timeout: 20_000 });
  await searchInput.fill(supplierName);

  await page.getByRole('option', { name: new RegExp(escapeRegExp(supplierName), 'i') }).click();
}

test('@regression @products @manual creates product with preferred supplier', async ({ page }) => {
  requireCredentialsOrSkip();

  const suffix = Date.now();
  const supplierName = await createSupplier(page, suffix);
  const product = fakerDataService.buildProductFake(suffix, 'preferred');

  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(product.name);
  await page.locator('input[name="sku"]').fill(product.sku);
  await page.locator('input[name="stock"]').fill(product.initialStock);

  await selectPreferredSupplier(page, supplierName);

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/products')
  );

  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);

  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])/i, { timeout: 20_000 });

  const search = page.getByPlaceholder(/buscar|search/i).first();
  await search.fill(product.name);

  const row = page
    .getByRole('row', {
      name: new RegExp(
        `${escapeRegExp(product.name)}.*${escapeRegExp(supplierName)}|${escapeRegExp(supplierName)}.*${escapeRegExp(product.name)}`,
        'i'
      ),
    })
    .first();

  await expect(row).toBeVisible({ timeout: 20_000 });
});

test('@regression @products @manual creates product with additional presentation', async ({ page }) => {
  requireCredentialsOrSkip();

  const product = fakerDataService.buildProductFake(Date.now(), 'multi-presentation');

  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(product.name);
  await page.locator('input[name="sku"]').fill(product.sku);
  await page.locator('input[name="stock"]').fill(product.initialStock);

  await addPresentationInEditorModal(page, '6');

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/products')
  );
  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);

  const createdProduct = (await createResponse.json()) as CreatedProductResponse;

  await page.goto(`/catalog/products/${createdProduct.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit(?:$|[?#])/i, { timeout: 20_000 });

  const presentationsRows = page.locator('tbody tr');
  await expect(presentationsRows.first()).toBeVisible({ timeout: 20_000 });
  const presentationsCount = await presentationsRows.count();
  expect(presentationsCount).toBeGreaterThan(1);
  await expect(page.getByText('6').first()).toBeVisible({ timeout: 20_000 });
});
