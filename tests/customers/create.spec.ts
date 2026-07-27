import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakerDataService } from '../../services/fakerDataService';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

function customerRow(page: Page, customerName: string): Locator {
  return page.locator('tbody tr', { hasText: customerName }).first();
}

async function openNewCustomerForm(page: Page) {
  await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/customers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo cliente|new customer/i }).click();
  await expect(page.getByText(/nuevo cliente|new customer/i).first()).toBeVisible({
    timeout: 20_000,
  });
}

async function fillBaseCustomerForm(
  page: Page,
  data: ReturnType<typeof fakerDataService.buildCustomerFake>
) {
  await page.getByLabel(/nombre completo|full name/i).fill(data.name);
  await page.getByLabel(/email/i).fill(data.email);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(data.phone);
  await page.getByLabel(/calle y n[uú]mero|street/i).fill(data.street);
  await page.getByLabel(/ciudad|city/i).fill(data.city);
  await page.getByLabel(/estado|provincia|state/i).fill(data.state);
}

test('@regression @customers @manual creates a cash customer', async ({ page }) => {
  requireCredentialsOrSkip('customer creation flows');

  const fakeCustomer = fakerDataService.buildCustomerFake(Date.now());

  await openNewCustomerForm(page);
  await fillBaseCustomerForm(page, fakeCustomer);

  await expect(page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toHaveCount(0);
  await expect(page.getByLabel(/plazo .*d[ií]as|credit term/i)).toHaveCount(0);

  await page.getByRole('button', { name: /guardar|save/i }).last().click();

  const searchInput = page.getByPlaceholder(/buscar|search/i).first();
  await searchInput.fill(fakeCustomer.name);

  const row = customerRow(page, fakeCustomer.name);
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.getByRole('button', { name: /editar|edit/i }).click();
  await expect(page.getByText(/editar cliente|edit customer/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toHaveCount(0);
});

test('@regression @customers @manual creates a credit customer with limit', async ({ page }) => {
  requireCredentialsOrSkip('customer creation flows');

  const fakeCustomer = fakerDataService.buildCustomerFake(Date.now());

  await openNewCustomerForm(page);
  await fillBaseCustomerForm(page, fakeCustomer);

  await page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i }).click();
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i).fill('1800');
  await page.getByLabel(/plazo .*d[ií]as|credit term/i).fill('30');

  await page.getByRole('button', { name: /guardar|save/i }).last().click();

  const searchInput = page.getByPlaceholder(/buscar|search/i).first();
  await searchInput.fill(fakeCustomer.name);

  const row = customerRow(page, fakeCustomer.name);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('1800.00');

  await row.getByRole('button', { name: /editar|edit/i }).click();
  await expect(page.getByText(/editar cliente|edit customer/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toHaveValue('1800');
  await expect(page.getByLabel(/plazo .*d[ií]as|credit term/i)).toHaveValue('30');
});
