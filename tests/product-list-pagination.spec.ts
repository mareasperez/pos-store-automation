import { expect, test } from '@playwright/test';

/**
 * Product list pagination smoke tests.
 * Requires at least 11 products in the tenant for page-navigation assertions.
 * Uses the authenticated project (default, no @auth tag).
 */
test.describe('Product list — pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/catalog/products', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/catalog\/products/, { timeout: 20_000 });
  });

  test('shows pagination controls when products exist', async ({ page }) => {
    // Wait for the table to load (loading row disappears)
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    // Pagination footer must be present
    await expect(page.getByRole('navigation', { name: /pagination/i })).toBeVisible();
  });

  test('default rows-per-page selector shows 10', async ({ page }) => {
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    const trigger = page.getByRole('combobox');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText('10');
  });

  test('rows-per-page selector has options 10, 25, 50, 100', async ({ page }) => {
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    await page.getByRole('combobox').click();

    for (const option of ['10', '25', '50', '100']) {
      await expect(page.getByRole('option', { name: option })).toBeVisible();
    }
  });

  test('changing rows-per-page resets to page 1', async ({ page }) => {
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    // Navigate to page 2 if possible
    const page2 = page.getByRole('link', { name: '2' });
    const hasPage2 = await page2.isVisible().catch(() => false);
    if (hasPage2) {
      await page2.click();
      await expect(page.getByRole('link', { name: '2' })).toHaveAttribute('data-active', 'true');
    }

    // Change page size to 25
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: '25' }).click();

    // Should be back on page 1
    const page1Link = page.getByRole('link', { name: '1' });
    await expect(page1Link).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
  });

  test('search resets pagination to page 1', async ({ page }) => {
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    // Only navigate to page 2 if it exists
    const page2 = page.getByRole('link', { name: '2' });
    const hasPage2 = await page2.isVisible().catch(() => false);
    if (hasPage2) {
      await page2.click();
      await expect(page.getByRole('link', { name: '2' })).toHaveAttribute('data-active', 'true');
    }

    // Type something in the search box
    const search = page.getByPlaceholder(/buscar/i);
    await search.fill('z');

    // Page 1 must be active (or no pages visible because 0 results)
    const page1Link = page.getByRole('link', { name: '1' });
    const isPage1Visible = await page1Link.isVisible().catch(() => false);
    if (isPage1Visible) {
      await expect(page1Link).toHaveAttribute('data-active', 'true', { timeout: 5_000 });
    }
  });
});
