import { expect, test } from '@playwright/test';
import { config } from '@config';
import { fakerDataService } from '../services/fakerDataService';

function requireCredentialsOrSkip() {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run supplier creation flows.'
  );
}

test('@manual @suppliers creates a supplier and shows it in suppliers list', async ({ page }) => {
  requireCredentialsOrSkip();

  const fakeSupplier = fakerDataService.buildSupplierFake(Date.now());

  await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/suppliers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo proveedor|new supplier/i }).click();
  await expect(page.getByText(/nuevo proveedor|new supplier/i).first()).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/nombre de empresa|company name/i).fill(fakeSupplier.name);
  await page.getByLabel(/nombre de contacto|contact name/i).fill(fakeSupplier.contactName);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(fakeSupplier.phone);
  await page.getByLabel(/email/i).fill(fakeSupplier.email);
  await page.getByLabel(/direcci[oó]n|address/i).fill(fakeSupplier.address);

  await page.getByRole('button', { name: /guardar|save/i }).last().click();

  await expect(page.getByText(fakeSupplier.name)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fakeSupplier.email)).toBeVisible({ timeout: 20_000 });
});
