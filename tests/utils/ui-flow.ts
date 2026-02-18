import { expect, type Locator, type Page } from '@playwright/test';
import { config } from '../../utils/config';

export const UI_TIMEOUT = 60_000;

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}`;
}

export async function loginOrFail(page: Page) {
  await page.goto('/login');

  // Wait for cold start loader if present
  const loader = page.locator('.cold-start-loader');
  if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Cold start loader detected, waiting for it to disappear...');
    await loader.waitFor({ state: 'detached', timeout: UI_TIMEOUT });
  }

  await page.fill('input[name="username"]', config.credentials.username);
  await page.fill('input[name="password"]', config.credentials.password);
  await page.click('button[type="submit"]');

  const loginError = page.locator('#login-error');

  const loginResult = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.includes('/login'), {
        timeout: UI_TIMEOUT,
        waitUntil: 'domcontentloaded',
      })
      .then(() => 'navigated' as const),
    loginError
      .waitFor({ state: 'visible', timeout: UI_TIMEOUT })
      .then(() => 'error' as const)
      .catch(() => 'timeout' as const),
  ]);

  if (loginResult !== 'navigated') {
    const errorText = (await loginError.textContent().catch(() => null))?.trim() || 'no detail';
    console.log(`Login failed. Current URL: ${page.url()}`);
    throw new Error(
      `Login did not complete. Check TEST_USERNAME/TEST_PASSWORD in automation/.env or root .env. UI error: ${errorText}`
    );
  }

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: UI_TIMEOUT });
}

export async function createSupplierViaUI(page: Page, supplierName: string) {
  await page.goto('/suppliers');
  await expect(page.getByRole('heading', { name: /Proveedores/i })).toBeVisible({ timeout: UI_TIMEOUT });

  await page.getByRole('button', { name: /Nuevo Proveedor/i }).click();

  await page.getByLabel('Nombre de Empresa').fill(supplierName);
  await page.getByLabel('Nombre de Contacto').fill(`Contacto ${Date.now()}`);
  await page.getByLabel('Email').fill(`supplier.${Date.now()}@e2e.test`);
  await page.getByLabel(/Telefono|Tel.fono/i).fill('55123456');
  await page.getByLabel(/Direccion|Direcci.n/i).fill('Direccion E2E');
  await page.getByRole('button', { name: /^Guardar$/ }).click();

  await expect(page.getByText(/Nuevo Proveedor|Editar Proveedor/i)).not.toBeVisible({
    timeout: UI_TIMEOUT,
  });
}

export async function createCustomerViaUI(page: Page, customerName: string) {
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: /Clientes/i })).toBeVisible({ timeout: UI_TIMEOUT });

  await page.getByRole('button', { name: /Nuevo Cliente/i }).click();
  await page.getByLabel('Nombre Completo').fill(customerName);
  await page.getByLabel('Email').fill(`customer.${Date.now()}@e2e.test`);
  await page.getByLabel(/Telefono|Tel.fono/i).fill('77123456');
  await page.getByLabel(/Calle y Numero|Calle y N.mero/i).fill('Calle E2E 123');
  await page.getByLabel('Ciudad').fill('Managua');
  await page.getByRole('button', { name: /^Guardar$/ }).click();

  const customerSearch = page.getByPlaceholder(/Buscar por nombre, telefono o email/i);
  await customerSearch.fill(customerName);
  await expect(page.getByText(customerName)).toBeVisible({ timeout: UI_TIMEOUT });
}

export async function selectTypeaheadOption(input: Locator, query: string) {
  await input.fill(query);

  const option = input
    .page()
    .locator('.typeahead__list .typeahead__item:not(.typeahead__item--empty)')
    .first();

  await expect(option).toBeVisible({ timeout: UI_TIMEOUT });
  await option.click();
}

export async function selectAnySku(page: Page): Promise<string> {
  const skuInput = page.getByPlaceholder(/Buscar i.tem|Buscar .*item/i);
  const attempts = ['a', 'e', 'i', 'o', 'u', '1'];

  for (const query of attempts) {
    await skuInput.fill(query);
    const option = page.locator('.typeahead__list .typeahead__item:not(.typeahead__item--empty)').first();

    if (await option.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const optionText = (await option.textContent())?.trim() || '';
      await option.click();
      return optionText;
    }
  }

  throw new Error('No SKU option was found to register purchase.');
}

export async function createPurchaseViaUI(page: Page, supplierName: string): Promise<string> {
  await page.goto('/inventory/purchases/new');
  await expect(page.getByRole('heading', { name: /Compra de Productos/i })).toBeVisible({
    timeout: UI_TIMEOUT,
  });

  const supplierTypeahead = page.getByPlaceholder(/Buscar proveedor/i);
  await selectTypeaheadOption(supplierTypeahead, supplierName);

  const selectedSkuText = await selectAnySku(page);

  await page.getByLabel('Cantidad').fill('1');
  await page.getByLabel('Costo Unit.').fill('10');
  await page.getByRole('button', { name: /Agregar Linea|Agregar L.nea/i }).click();

  await expect(page.getByRole('table')).toBeVisible({ timeout: UI_TIMEOUT });

  const purchaseDialogPromise = page.waitForEvent('dialog');
  await page.getByRole('button', { name: /Comprar/i }).click();
  const purchaseDialog = await purchaseDialogPromise;

  expect(purchaseDialog.message()).toContain('successfully');
  await purchaseDialog.accept();

  return selectedSkuText;
}

export async function ensureShiftIsOpen(page: Page) {
  const openShiftButton = page.getByRole('button', { name: /Abrir Caja|Open Shift/i }).first();
  if (!(await openShiftButton.isVisible({ timeout: 2_000 }).catch(() => false))) return;

  await openShiftButton.click();
  await page.getByLabel(/Monto Inicial|Initial Cash/i).fill('100');
  await page.getByRole('button', { name: /Abrir Caja|Open Shift/i }).last().click();
}
