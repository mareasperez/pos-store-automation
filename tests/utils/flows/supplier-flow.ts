import { expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import esTranslation from '@i18n/es/translation.json';
import { UI_TIMEOUT } from '@utils/ui-flow';
import { waitForBootstrap } from './auth-flow';

export async function createSupplierViaUI(page: Page, supplierName: string) {
  await page.goto('/suppliers?lng=es');
  
  // Wait for initial bootstrap on navigation
  await waitForBootstrap(page);

  // Wait for the specific heading to be visible, ignoring level for robustness
  const heading = page.getByRole('heading', { name: esTranslation.suppliers.title, exact: false });
  
  try {
    await heading.waitFor({ state: 'visible', timeout: UI_TIMEOUT });
  } catch (e) {
    const screenshotPath = `failure-suppliers-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`DEBUG: Failed to find heading. Screenshot saved to ${screenshotPath}`);
    console.log('DEBUG: Current URL:', page.url());
    console.log('DEBUG: Root HTML:', await page.locator('#root').innerHTML().catch(() => 'EMPTY'));
    throw e;
  }

  await expect(heading).toBeVisible();

  // The button in JSX uses suppliers.new_supplier
  await page.getByRole('button', { name: esTranslation.suppliers.new_supplier, exact: false }).click();

  await page.getByLabel(esTranslation.suppliers.form.name).fill(supplierName);
  await page.getByLabel(esTranslation.suppliers.form.contact_name).fill(faker.person.fullName());
  await page.getByLabel(esTranslation.suppliers.form.email).fill(`supplier.${Date.now()}@e2e.test`);
  await page.getByLabel(esTranslation.suppliers.form.phone).fill(faker.phone.number());
  await page.getByLabel(esTranslation.suppliers.form.address).fill(faker.location.streetAddress());
  await page.getByRole('button', { name: esTranslation.suppliers.form.save }).click();

  // Wait for the modal to close by checking the dialog role, avoiding title text collisions
  await expect(page.getByRole('dialog')).not.toBeVisible({
    timeout: UI_TIMEOUT,
  });
}
