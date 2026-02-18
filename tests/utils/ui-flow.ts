import { expect, type Locator, type Page } from '@playwright/test';
import { config } from '../../utils/config';
import { faker } from '@faker-js/faker';
import esTranslation from '../../../frontend/public/locales/es/translation.json';

export const UI_TIMEOUT = 60_000;

export function uniqueName(prefix: string): string {
  return `${prefix} ${faker.word.adjective()} ${Date.now().toString().slice(-4)}`;
}
 
export async function loginOrFail(page: Page) {
  // Capture browser console logs for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`PAGE ERROR: ${msg.text()}`);
  });

  // Ensure Spanish is set before any JS loads
  await page.addInitScript(() => {
    window.localStorage.setItem('i18nextLng', 'es');
  });

  await page.goto('/login?lng=es');
  
  // Wait for the app to at least start rendering
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: UI_TIMEOUT });
  
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
  
  // Wait for the page to be ready
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: UI_TIMEOUT });
  
  // Wait for the specific heading to be visible, ignoring level for robustness
  const heading = page.getByRole('heading', { name: esTranslation.suppliers.title });
  
  try {
    await heading.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    console.log('DEBUG: Failed to find heading. Current URL:', page.url());
    console.log('DEBUG: Root HTML:', await page.locator('#root').innerHTML());
    throw e;
  }

  await expect(heading).toBeVisible();

  await page.getByRole('button', { name: esTranslation.suppliers.form.title_new }).click();

  await page.getByLabel(esTranslation.suppliers.form.name).fill(supplierName);
  await page.getByLabel(esTranslation.suppliers.form.contact_name).fill(faker.person.fullName());
  await page.getByLabel(esTranslation.suppliers.form.email).fill(`supplier.${Date.now()}@e2e.test`);
  await page.getByLabel(esTranslation.suppliers.form.phone).fill(faker.phone.number());
  await page.getByLabel(esTranslation.suppliers.form.address).fill(faker.location.streetAddress());
  await page.getByRole('button', { name: esTranslation.suppliers.form.save }).click();

  await expect(page.getByText(new RegExp(`${esTranslation.suppliers.form.title_new}|${esTranslation.suppliers.form.title_edit}`, 'i'))).not.toBeVisible({
    timeout: UI_TIMEOUT,
  });
}

export async function createCustomerViaUI(page: Page, customerName: string) {
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: esTranslation.customers.title })).toBeVisible({ timeout: UI_TIMEOUT });

  await page.getByRole('button', { name: esTranslation.customers.actions.new }).click();
  
  // Use faker but keep the e2e suffix requirements where needed or just realistic
  // The user asked for "real names" but with "e2e+ number" suffix
  const realName = faker.person.fullName();
  const suffix = `e2e-${Date.now().toString().slice(-4)}`; 
  const fullName = `${realName} (${suffix})`;

  await page.getByLabel(esTranslation.customers.form.full_name).fill(fullName);
  await page.getByLabel(esTranslation.customers.form.email).fill(faker.internet.email({ firstName: 'e2e', lastName: suffix }));
  await page.getByLabel(esTranslation.customers.form.phone).fill(faker.string.numeric(8));
  await page.getByLabel(esTranslation.customers.form.street).fill(faker.location.streetAddress());
  await page.getByLabel(esTranslation.customers.form.city).fill(faker.location.city());
  await page.getByRole('button', { name: esTranslation.customers.form.save }).click();

  // Wait for the modal/drawer to close before searching
  await expect(page.getByRole('heading', { name: esTranslation.customers.form.title_new })).not.toBeVisible({ timeout: UI_TIMEOUT });
  console.log('Customer modal closed. Searching for new customer...');

  const customerSearch = page.getByPlaceholder(esTranslation.pos.customer_search_placeholder);
  await expect(customerSearch).toBeEditable({ timeout: UI_TIMEOUT });
  await customerSearch.fill(fullName);
  await expect(page.getByText(fullName)).toBeVisible({ timeout: UI_TIMEOUT });
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
  // Use inventory search placeholder from translation
  const skuInput = page.getByPlaceholder(esTranslation.inventory.search_placeholder);
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
  // Heading from inventory.purchase_receipt.title
  await expect(page.getByRole('heading', { name: esTranslation.inventory.purchase_receipt.title.replace(' (AIO)', '') })).toBeVisible({
    timeout: UI_TIMEOUT,
  });

  const supplierTypeahead = page.getByPlaceholder(esTranslation.inventory.purchase_history.supplier);
  await selectTypeaheadOption(supplierTypeahead, supplierName);

  const selectedSkuText = await selectAnySku(page);

  await page.getByLabel(esTranslation.pos.ticket.qty).fill('1');
  await page.getByLabel(esTranslation.inventory.purchase_receipt.invoice_ref).fill('REF-123');
  await page.getByRole('button', { name: esTranslation.inventory.purchase_receipt.save }).click();

  await expect(page.getByRole('table')).toBeVisible({ timeout: UI_TIMEOUT });

  const purchaseDialogPromise = page.waitForEvent('dialog');
  await page.getByRole('button', { name: /Comprar/i }).click();
  const purchaseDialog = await purchaseDialogPromise;

  expect(purchaseDialog.message()).toContain('successfully');
  await purchaseDialog.accept();

  return selectedSkuText;
}

export async function ensureShiftIsOpen(page: Page) {
  const openShiftButton = page.getByRole('button', { name: esTranslation.shifts.open_shift_button }).first();
  if (!(await openShiftButton.isVisible({ timeout: 2_000 }).catch(() => false))) return;

  await openShiftButton.click();
  await page.getByLabel(esTranslation.shifts.initial_cash).fill('100');
  await page.getByRole('button', { name: esTranslation.shifts.open_shift_button }).last().click();
}
