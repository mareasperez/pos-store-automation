import { expect, type Page } from '@playwright/test';
import { fakerDataService } from '../../services/fakerDataService';

export type SupplierCreationOptions = {
  paymentTerm?: 'IMMEDIATE' | 'CREDIT';
  creditLimit?: string;
  allowCreditLimitExceed?: boolean;
  uniqueTag?: string;
};

export async function createSupplier(
  page: Page,
  seed: number,
  options?: SupplierCreationOptions
) {
  const supplier = fakerDataService.buildSupplierFake(seed, options?.uniqueTag);

  await page.goto('/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/suppliers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo proveedor|new supplier/i }).click();
  await expect(page.getByText(/nuevo proveedor|new supplier/i).first()).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/nombre de empresa|company name/i).fill(supplier.name);
  await page.getByLabel(/nombre de contacto|contact name/i).fill(supplier.contactName);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(supplier.phone);
  await page.getByLabel(/email/i).fill(supplier.email);
  await page.getByLabel(/direcci[oó]n|address/i).fill(supplier.address);

  if (options?.paymentTerm === 'CREDIT') {
    await page.getByLabel(/condicion de pago|payment term/i).selectOption('CREDIT');

    if (options.creditLimit) {
      await page.getByLabel(/limite de credito|credit limit/i).fill(options.creditLimit);
    }

    if (options.allowCreditLimitExceed) {
      await page
        .getByRole('checkbox', { name: /permitir exceder l[ií]mite de cr[eé]dito/i })
        .click();
    }
  }

  await page.getByRole('button', { name: /guardar|save/i }).last().click();
  await expect(page.getByText(supplier.name)).toBeVisible({ timeout: 20_000 });

  return supplier;
}
