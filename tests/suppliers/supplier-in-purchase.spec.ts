import { expect, test, type TestInfo } from '@playwright/test';
import { buildUniqueTestToken } from '../../services/uniqueData';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { createSupplier } from '../../support/flows/suppliers.flow';
import { setBasePresentationPrice } from '../../support/flows/products.flow';
import { fakerDataService } from '../../services/fakerDataService';

// ── helpers ────────────────────────────────────────────────────────────────────

async function createPurchasableProductForSupplierTest(
  page: import('@playwright/test').Page,
  seed: number,
  uniqueTag: string
) {
  const product = fakerDataService.buildProductFake(seed, 'standard', uniqueTag);

  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(product.name);
  await page.locator('input[name="sku"]').fill(product.sku);
  await page.locator('input[name="stock"]').fill('0');
  await setBasePresentationPrice(page, '150', '100');

  const createResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/products')
  );
  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();
  const res = await createResponsePromise;
  expect(res.status()).toBe(201);
  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])/i, { timeout: 20_000 });

  return product;
}

// ── tests ──────────────────────────────────────────────────────────────────────

test('@regression @suppliers @purchases @manual supplier appears in purchase history row after creating a purchase', async (
  { page },
  testInfo: TestInfo
) => {
  requireCredentialsOrSkip('supplier-in-purchase flows');

  const seed = Date.now();
  const uniqueTag = buildUniqueTestToken(testInfo, 'SPH');
  const supplier = await createSupplier(page, seed, { uniqueTag });
  const product = await createPurchasableProductForSupplierTest(page, seed + 1, uniqueTag);
  const invoiceRef = `INV-SPH-${uniqueTag}`;

  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });

  // Select supplier via the combobox
  const supplierInput = page.getByTestId('purchase-supplier-input');
  await expect(supplierInput).toBeVisible({ timeout: 20_000 });
  await expect(supplierInput).not.toHaveAttribute('placeholder', /cargando/i, { timeout: 15_000 });
  await supplierInput.click();
  await expect(page.locator('[data-slot="combobox-item"]').first()).toBeVisible({ timeout: 10_000 });
  await supplierInput.pressSequentially(supplier.name, { delay: 40 });

  const option = page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: supplier.name })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  await page.getByPlaceholder('INV-9876').fill(invoiceRef);

  // Add a purchase line
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.fill(product.name.substring(0, 10));
  await page.getByRole('option', { name: new RegExp(product.name, 'i') }).first().click();
  const lineRow = page.locator('tbody tr', { hasText: product.name }).first();
  await expect(lineRow).toBeVisible({ timeout: 20_000 });

  // Confirm purchase
  const purchaseResponsePromise = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.url().includes('/api/inventory/purchase-receipts')
  );
  await page.getByRole('button', { name: /comprar|purchase/i }).click();
  await expect(page.getByText(/confirmar compra|confirm purchase/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /confirmar|confirm/i }).last().click();
  const purchaseResponse = await purchaseResponsePromise;
  expect(purchaseResponse.status()).toBeLessThan(300);

  await expect(page.getByText(/compra registrada|purchase registered/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /ver historial|view history/i }).click();

  // Find the purchase row and assert supplier is visible
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });
  const historySearch = page.getByPlaceholder(/buscar|search/i).first();
  await expect(historySearch).toBeVisible({ timeout: 20_000 });
  await historySearch.fill(invoiceRef);

  // The table row shows the PO code and supplier name, not the invoice ref.
  const row = page.locator('tbody tr', { hasText: supplier.name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(supplier.name);
});
