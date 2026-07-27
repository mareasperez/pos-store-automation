import { expect, test } from '@playwright/test';
import {
  gotoProductList,
  openFirstProductPreview,
  waitProductsLoaded,
} from '../../../support/pages/products-list.page';

/**
 * Product preview dialog smoke tests.
 * Requires at least 1 product in the tenant.
 * Uses the authenticated project (default, no @auth tag).
 */
test.describe('@regression @products @manual product preview dialog', () => {
  test.beforeEach(async ({ page }) => {
    await gotoProductList(page);
    await waitProductsLoaded(page);
  });

  test('opens dialog when clicking a product row', async ({ page }) => {
    await openFirstProductPreview(page);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  test('dialog shows product name in title', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // DialogTitle (h2) must have non-empty text
    const title = dialog.getByRole('heading');
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('dialog shows avatar (initials or image)', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Either an img inside the avatar or the fallback span with initials must be present
    const avatarImage = dialog.locator('img[alt]');
    const avatarFallback = dialog.locator('[data-slot="avatar-fallback"]');

    const hasImage = await avatarImage.isVisible().catch(() => false);
    const hasFallback = await avatarFallback.isVisible().catch(() => false);

    expect(hasImage || hasFallback).toBe(true);
  });

  test('dialog has active/inactive badge', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const badge = dialog.locator('span').filter({ hasText: /activo|inactivo/i }).first();
    await expect(badge).toBeVisible();
  });

  test('dialog shows Categoría and Proveedor fields', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(/categoría/i)).toBeVisible();
    await expect(dialog.getByText(/proveedor/i)).toBeVisible();
  });

  test('dialog shows Tipo field', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(/tipo/i)).toBeVisible();
  });

  test('dialog shows Stock mínimo and Stock máximo fields', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(/stock m[ií]nimo/i)).toBeVisible();
    await expect(dialog.getByText(/stock m[áa]ximo/i)).toBeVisible();
  });

  test('dialog shows Descripción section', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(/descripción/i)).toBeVisible();
  });

  test('dialog shows Presentaciones section', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByText(/presentaciones/i)).toBeVisible();
  });

  test('dialog has Editar producto button', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByRole('button', { name: /editar/i })).toBeVisible();
  });

  test('dialog has Cerrar button that closes it', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: /cerrar/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('Editar producto button navigates to edit page', async ({ page }) => {
    await openFirstProductPreview(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole('button', { name: /editar/i }).click();

    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/, { timeout: 10_000 });
  });
});
