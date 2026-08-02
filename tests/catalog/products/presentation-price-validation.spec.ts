import { expect, test } from '@playwright/test';
import { fakerDataService } from '../../../services/fakerDataService';
import {
  createProductWithInitialStock,
  requireCredentialsOrSkip,
} from '../../../support/flows/products.flow';

test.describe('@regression @products @manual presentation price=0 is rejected', () => {
  test('Save button in editor modal is disabled when price is 0', async ({ page }) => {
    requireCredentialsOrSkip();

    const product = fakerDataService.buildProductFake(Date.now(), 'standard');
    const created = await createProductWithInitialStock(
      page,
      product.name,
      product.sku,
      product.initialStock
    );

    await page.goto(`/catalog/products/${created.id}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 20_000 });

    await page.getByRole('button', { name: /add presentation|agregar presentaci[oó]n/i }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    await modal.getByLabel(/factor|conversion factor/i).fill('6');
    await modal.getByLabel(/^costo$|^cost$/i).fill('50');

    const priceInput = modal.getByLabel(/^precio$|^price$/i);
    await priceInput.fill('0');

    const saveButton = modal.getByRole('button', { name: /^save$|^guardar$/i });
    await expect(saveButton).toBeDisabled();

    // Entering a valid price re-enables Save
    await priceInput.fill('99');
    await expect(saveButton).toBeEnabled({ timeout: 3_000 });
  });

  test('Saving product with base presentation price=0 is blocked by UI', async ({ page }) => {
    requireCredentialsOrSkip();

    await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

    await page.locator('input[name="name"]').fill('Test Zero Price Product');
    await page.locator('input[name="sku"]').fill('SKU-ZERO-TEST');
    const stockInput = page.locator('input[name="stock"]');
    await expect(stockInput).toBeVisible({ timeout: 20_000 });
    await stockInput.fill('0');

    // Do NOT set a price — base presentation defaults to 0

    // No POST to /api/products should happen
    let apiCallMade = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/products')) {
        apiCallMade = true;
      }
    });

    await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

    // Guard blocks the call — still on the same page, no navigation
    await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 5_000 });
    expect(apiCallMade).toBe(false);
  });
});
