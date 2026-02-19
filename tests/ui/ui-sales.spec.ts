import { test, expect } from '@playwright/test';
import {
  createPurchaseViaUI,
  createSupplierViaUI,
  ensureShiftIsOpen,
  loginOrFail,
  uniqueName,
  UI_TIMEOUT,
} from '@utils/ui-flow';

test('UI can register a sale and complete payment', async ({ page }) => {
  await loginOrFail(page);

  const supplierName = uniqueName('E2E Supplier Sale');
  await createSupplierViaUI(page, supplierName);
  const selectedSkuText = await createPurchaseViaUI(page, supplierName);

  await page.goto('/pos?lng=es');
  await expect(page.getByRole('heading', { name: /Ventas/i })).toBeVisible({ timeout: UI_TIMEOUT });

  await ensureShiftIsOpen(page);

  await page.getByRole('button', { name: /Buscar producto|Search product/i }).first().click();

  const searchInput = page.getByPlaceholder(/Nombre, c.digo o barcode/i);
  await searchInput.fill(selectedSkuText.split('Stock:')[0].trim());

  const firstProductCard = page.locator('.product-search-modal [data-nav-item="true"]').first();
  await expect(firstProductCard).toBeVisible({ timeout: UI_TIMEOUT });
  await firstProductCard.click();

  await page.getByRole('button', { name: /Confirmar Venta|Confirm Sale/i }).first().click();
  await page.getByRole('button', { name: /Restante|Remaining/i }).click();
  await page.getByRole('button', { name: /Finalizar Venta|Finalize Sale/i }).click();

  await expect(page.getByText(/Recibo de Venta|Sale Receipt/i)).toBeVisible({ timeout: UI_TIMEOUT });
});
