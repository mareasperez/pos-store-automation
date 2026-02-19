import { expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import esTranslation from '@i18n/es/translation.json';
import { UI_TIMEOUT } from '@utils/ui-flow';

export async function createSupplierViaUI(page: Page, supplierName: string) {
  await page.goto('/suppliers?lng=es');
  
  // Wait for the page to be ready
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: UI_TIMEOUT });
  
  // Wait for the specific heading to be visible, ignoring level for robustness
  const heading = page.getByRole('heading', { name: esTranslation.suppliers.title });
  
  try {
    await heading.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    const screenshotPath = `failure-suppliers-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`DEBUG: Failed to find heading. Screenshot saved to ${screenshotPath}`);
    console.log('DEBUG: Current URL:', page.url());
    console.log('DEBUG: Root HTML:', await page.locator('#root').innerHTML().catch(() => 'EMPTY'));
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
