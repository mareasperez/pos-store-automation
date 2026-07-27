import { expect, test } from '@playwright/test';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { createSupplier } from '../../support/flows/suppliers.flow';

test('@regression @suppliers @manual creates a supplier and shows it in suppliers list', async ({ page }) => {
  requireCredentialsOrSkip('supplier creation flows');

  const fakeSupplier = await createSupplier(page, Date.now());

  await expect(page.getByText(fakeSupplier.name)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fakeSupplier.email)).toBeVisible({ timeout: 20_000 });
});

test('@regression @suppliers @manual creates a credit supplier with credit limit', async ({ page }) => {
  requireCredentialsOrSkip('supplier creation flows');

  const creditLimit = '2500';

  const fakeSupplier = await createSupplier(page, Date.now(), {
    paymentTerm: 'CREDIT',
    creditLimit,
    allowCreditLimitExceed: true,
  });

  const row = page.locator('tbody tr', { hasText: fakeSupplier.name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.getByRole('button', { name: /editar|edit/i }).click();
  await expect(page.getByText(/editar proveedor|edit supplier/i).first()).toBeVisible({ timeout: 20_000 });

  await expect(page.getByLabel(/condicion de pago|payment term/i)).toHaveValue('CREDIT');
  await expect(page.getByLabel(/limite de credito|credit limit/i)).toHaveValue(creditLimit);
  await expect(
    page.getByRole('checkbox', { name: /permitir exceder l[ií]mite de cr[eé]dito/i })
  ).toHaveAttribute('aria-checked', 'true');
});
