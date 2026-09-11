import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { fakerDataService } from '../../services/fakerDataService';
import { buildApiHeaders } from './sales.flow';

export interface CreditCustomer {
  id: number;
  name: string;
}

export interface CreatedCreditSale {
  id: number;
  total: number;
}

interface Customer {
  id: number;
  name: string;
  status?: string;
  creditActive?: boolean;
}

/**
 * Finds an active credit-enabled customer (excluding the walk-in id=1), or creates one via the UI.
 * Prefers the eligible customer with the fewest open receivables instead of always the first
 * match, so specs reusing a credit customer don't keep growing one "snowball" customer run after run.
 */
export async function findOrCreateCreditCustomer(page: Page): Promise<CreditCustomer> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/customers`, { headers });
  expect(res.ok(), `GET /customers failed: ${res.status()}`).toBeTruthy();
  const customers = (await res.json()) as Customer[];

  const eligible = customers.filter(
    (c) => c.id !== 1 && c.status !== 'INACTIVE' && c.creditActive === true
  );

  if (eligible.length) {
    const summaryRes = await page.request.get(
      `${config.apiRoot}/receivables/customers-summary?page=0&size=200`,
      { headers }
    );
    const openReceivablesByCustomerId = new Map<number, number>();
    if (summaryRes.ok()) {
      const summary = (await summaryRes.json()) as {
        content: Array<{ customerId: number; openReceivablesCount: number }>;
      };
      for (const row of summary.content) {
        openReceivablesByCustomerId.set(row.customerId, row.openReceivablesCount);
      }
    }

    const leastLoaded = eligible.reduce((smallest, candidate) => {
      const candidateCount = openReceivablesByCustomerId.get(candidate.id) ?? 0;
      const smallestCount = openReceivablesByCustomerId.get(smallest.id) ?? 0;
      return candidateCount < smallestCount ? candidate : smallest;
    });
    return { id: leastLoaded.id, name: leastLoaded.name };
  }

  const fake = fakerDataService.buildCustomerFake(Date.now());
  await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/customers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo cliente|new customer/i }).click();
  await expect(page.getByText(/nuevo cliente|new customer/i).first()).toBeVisible({
    timeout: 20_000,
  });

  await page.getByLabel(/nombre completo|full name/i).fill(fake.name);
  await page.getByLabel(/email/i).fill(fake.email);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(fake.phone);
  await page.getByLabel(/calle y n[uú]mero|street/i).fill(fake.street);
  await page.getByLabel(/ciudad|city/i).fill(fake.city);
  await page.getByLabel(/estado|provincia|state/i).fill(fake.state);

  await page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i }).click();
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i).fill('5000');
  await page.getByLabel(/plazo .*d[ií]as|credit term/i).fill('30');

  const createResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/customers'),
    { timeout: 20_000 }
  );
  await page
    .getByRole('button', { name: /guardar|save/i })
    .last()
    .click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created = (await createResponse.json()) as Customer;
  return { id: created.id, name: fake.name };
}

async function hasActiveShift(page: Page): Promise<boolean> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/shifts/active`, {
    headers: { ...headers, 'Cache-Control': 'no-cache' },
  });
  return res.status() === 200;
}

export async function openShiftIfPrompted(page: Page): Promise<void> {
  if (!(await hasActiveShift(page))) {
    const openBtn = page.locator('[data-testid="pos-open-shift"]:visible');
    await expect(openBtn).toBeAttached({ timeout: 20_000 });
    await openBtn.click();

    const cashInput = page.getByTestId('shift-initial-cash-input');
    await expect(cashInput).toBeVisible({ timeout: 8_000 });
    await cashInput.fill('1');

    const openResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
      { timeout: 20_000 }
    );
    const submitBtn = page.getByTestId('shift-open-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();
    expect((await openResponse).status()).toBeLessThan(300);
  }

  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeAttached({
    timeout: 20_000,
  });
}

async function addProductToCart(page: Page, productName: string): Promise<void> {
  const searchInput = page.getByTestId('pos-product-search');
  await searchInput.fill(productName.substring(0, 30));
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

  const options = page.getByRole('option');
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const text = (await option.textContent()) ?? '';
    const lower = text.toLowerCase();
    if (
      !lower.includes('sin stock') &&
      !lower.includes('out of stock') &&
      text.includes(productName.substring(0, 20))
    ) {
      await option.click();
      return;
    }
  }
  await options.first().click();
}

/** Attaches the given customer to the current sale via the POS customer selector. */
export async function selectPosCustomer(page: Page, customerName: string): Promise<void> {
  // Selecting a customer triggers an async fetch of their receivable balance (used to gate
  // "Venta a crédito" in the checkout decision modal). Wait for it so the credit-sale click
  // below doesn't race a still-pending balance and get silently blocked.
  const balanceResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes('/api/receivables/summary'),
    { timeout: 15_000 }
  );
  await page.getByTestId('pos-customer-select').click();
  await page.getByRole('option', { name: new RegExp(customerName, 'i') }).click();
  await balanceResponsePromise;
}

/** Confirms a credit sale with no initial payment and returns the created sale. */
export async function makeCreditSaleWithDetails(
  page: Page,
  productName: string
): Promise<CreatedCreditSale> {
  await addProductToCart(page, productName);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-credit-sale').click();

  // Default state has no initial payment editor open — "Confirmar venta a crédito" finances 100%.
  await expect(page.getByTestId('pm-finalize')).toBeVisible({ timeout: 10_000 });

  const saleResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
    { timeout: 20_000 }
  );
  await page.getByTestId('pm-finalize').click();
  await page.getByRole('button', { name: /s[ií], confirmar/i }).click();

  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status(), await saleResponse.text()).toBe(201);
  const sale = (await saleResponse.json()) as CreatedCreditSale;

  await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

  return { id: sale.id, total: Number(sale.total) };
}

/** Confirms a credit sale with no initial payment and returns the created sale total. */
export async function makeCreditSale(page: Page, productName: string): Promise<number> {
  return (await makeCreditSaleWithDetails(page, productName)).total;
}
