import { expect, type Page } from '@playwright/test';
import { faker } from '@faker-js/faker';
import esTranslation from '@i18n/es/translation.json';
import { UI_TIMEOUT } from '@utils/ui-flow';

export async function createCustomerViaUI(page: Page, customerName: string) {
  await page.goto('/customers?lng=es');
  await expect(page.getByRole('heading', { name: esTranslation.customers.title })).toBeVisible({ timeout: UI_TIMEOUT });

  await page.getByRole('button', { name: esTranslation.customers.actions.new }).click();
  
  const realName = faker.person.fullName();
  const suffix = `e2e-${Date.now().toString().slice(-4)}`; 
  const fullName = `${realName} (${suffix})`;

  await page.getByLabel(esTranslation.customers.form.full_name).fill(fullName);
  await page.getByLabel(esTranslation.customers.form.email).fill(faker.internet.email({ firstName: 'e2e', lastName: suffix }));
  await page.getByLabel(esTranslation.customers.form.phone).fill(faker.string.numeric(8));
  await page.getByLabel(esTranslation.customers.form.street).fill(faker.location.streetAddress());
  await page.getByLabel(esTranslation.customers.form.city).fill(faker.location.city());
  await page.getByRole('button', { name: esTranslation.customers.form.save }).click();

  await expect(page.getByRole('heading', { name: esTranslation.customers.form.title_new })).not.toBeVisible({ timeout: UI_TIMEOUT });
  console.log('Customer modal closed. Searching for new customer...');

  const customerSearch = page.getByPlaceholder(esTranslation.pos.customer_search_placeholder);
  await expect(customerSearch).toBeEditable({ timeout: UI_TIMEOUT });
  await customerSearch.fill(fullName);
  await expect(page.getByText(fullName)).toBeVisible({ timeout: UI_TIMEOUT });
}
