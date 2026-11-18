import { expect, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { createSupplier } from '../../support/flows/suppliers.flow';

test('@regression @suppliers @manual creates a supplier and shows it in suppliers list', async ({
  page,
}) => {
  requireCredentialsOrSkip('supplier creation flows');

  const fakeSupplier = await createSupplier(page, Date.now());

  await expect(page.getByText(fakeSupplier.name)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fakeSupplier.email)).toBeVisible({ timeout: 20_000 });
});

test('@regression @suppliers @manual searches suppliers by contact and clears the directory search', async ({
  page,
}, testInfo) => {
  requireCredentialsOrSkip('supplier directory search flow');
  test.setTimeout(240_000);

  const searchTerm = `Directory Contact ${testInfo.workerIndex} ${Date.now()}`;
  let supplier: Awaited<ReturnType<typeof createSupplier>> | undefined;

  for (let index = 0; index < 11; index += 1) {
    const created = await createSupplier(page, Date.now() + index, {
      contactName: searchTerm,
      uniqueTag: `DIR-${testInfo.workerIndex}-${Date.now()}-${index}`,
    });

    if (index === 0) {
      supplier = created;
      await page.waitForTimeout(1100);
    }
  }

  if (!supplier) {
    throw new Error('Supplier directory search fixture was not created');
  }

  const search = page.getByRole('searchbox', { name: /buscar proveedores|search suppliers/i });
  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/api/inventory/suppliers/search') &&
      url.searchParams.get('search') === searchTerm &&
      url.searchParams.get('page') === '0'
    );
  });

  await search.fill(searchTerm);
  await filteredRequest;

  const row = page.locator('tbody tr', { hasText: supplier.name }).first();
  await expect(row).toHaveCount(0);
  const nextPage = page.getByTestId('pagination-next');
  await expect(nextPage).toBeEnabled();
  await nextPage.click();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(searchTerm);

  await row.getByRole('button', { name: /editar|edit/i }).click();
  const updatedContact = `${searchTerm} Updated`;
  await page.getByLabel(/nombre de contacto|contact name/i).fill(updatedContact);
  const refreshedFirstPage = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/api/inventory/suppliers/search') &&
      url.searchParams.get('search') === searchTerm &&
      url.searchParams.get('page') === '0'
    );
  });
  await page.getByRole('button', { name: /guardar|save/i }).last().click();
  await refreshedFirstPage;
  await expect(row).toHaveCount(0);

  const updatedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/api/inventory/suppliers/search') &&
      url.searchParams.get('search') === updatedContact
    );
  });
  await search.fill(updatedContact);
  await updatedRequest;
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.getByRole('button', { name: /eliminar|delete/i }).click();
  const deleteDialog = page.getByRole('dialog');
  await expect(deleteDialog).toContainText(/confirmar|confirm|eliminar|delete/i);
  const afterDeleteRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/api/inventory/suppliers/search') &&
      url.searchParams.get('search') === updatedContact
    );
  });
  await deleteDialog.getByRole('button', { name: /eliminar|delete/i }).click();
  await afterDeleteRequest;
  await expect(page.getByText(/sin resultados|no se encontraron|no matches/i)).toBeVisible({
    timeout: 20_000,
  });

  const clearedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname.endsWith('/api/inventory/suppliers/search') &&
      !url.searchParams.has('search')
    );
  });
  await search.clear();
  await clearedRequest;
  await expect(row).toBeVisible({ timeout: 20_000 });
});

test('@regression @suppliers @manual creates a credit supplier with credit limit', async ({
  page,
}) => {
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
  await expect(page.getByText(/editar proveedor|edit supplier/i).first()).toBeVisible({
    timeout: 20_000,
  });

  await expect(page.getByLabel(/condicion de pago|payment term/i)).toHaveValue('CREDIT');
  await expect(page.getByLabel(/limite de credito|credit limit/i)).toHaveValue(creditLimit);
  await expect(
    page.getByRole('checkbox', { name: /permitir exceder l[ií]mite de cr[eé]dito/i })
  ).toHaveAttribute('aria-checked', 'true');
});
