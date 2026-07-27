import { expect, type Page } from '@playwright/test';

export async function gotoProductList(page: Page): Promise<void> {
  await page.goto('/catalog/products', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])?/i, { timeout: 20_000 });
}

export async function waitProductsLoaded(page: Page): Promise<void> {
  await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });
}

export async function openFirstProductPreview(page: Page): Promise<void> {
  const firstRow = page.locator('table tbody tr').first();
  await expect(firstRow).toBeVisible({ timeout: 10_000 });
  await firstRow.click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
}