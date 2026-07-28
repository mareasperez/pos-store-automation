import { expect, type Locator, type Page } from '@playwright/test';

export async function gotoProductList(page: Page): Promise<void> {
  await page.goto('/catalog/products', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])?/i, { timeout: 20_000 });
}

export async function waitProductsLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });
}

export async function openFirstProductPreview(page: Page): Promise<void> {
  const firstRow = page.locator('table tbody tr').first();
  await openProductPreviewFromRow(page, firstRow);
}

export async function openProductPreviewFromRow(page: Page, row: Locator): Promise<void> {
  await expect(row).toBeVisible({ timeout: 10_000 });

  const actionsButton = row.getByRole('button', { name: /acciones|actions/i }).first();
  await actionsButton.click();
  await page.getByRole('button', { name: /ver detalle|view detail/i }).click();

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}
