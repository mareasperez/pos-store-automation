/**
 * Cross-module e2e: credit sale -> customer collection payment -> receivable balance validation.
 * Tag: @real @manual @receivables-destructive — a customer's receivable balance is tenant-wide
 * shared state (like stock/sequences), but unlike stock lookups this test can't route around
 * contention by trying another candidate: it reads the balance before/after each action and
 * asserts an exact delta, so a concurrent worker touching the same customer would make it flaky.
 * Excluded from the default parallel suite the same way @shift-destructive is (see
 * playwright.config.ts) and only runs via `npm run test:destructive:*` with --workers=1.
 *
 * Flow: find an existing credit-enabled customer (or create one) -> sell to them on credit with
 * no initial payment -> assert the server's receivable balance grew by the sale total -> register
 * a partial payment via Customer Collections (FIFO) -> assert the balance shrank by that payment.
 *
 * Run: npm run test:destructive:local (or test:destructive:dev)
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { fakerDataService } from '../../services/fakerDataService';
import { buildApiHeaders, getFirstSellableProduct } from '../../support/flows/sales.flow';

test.setTimeout(120_000);

type Customer = {
  id: number;
  name: string;
  status?: string;
  creditActive?: boolean;
};

type ReceivableBalanceSummary = {
  customerId: number;
  totalOutstanding: number;
  hasOutstandingBalance: boolean;
};

async function getReceivableBalance(page: Page, customerId: number): Promise<number> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(
    `${config.apiRoot}/receivables/summary?customerId=${customerId}`,
    { headers: { ...headers, 'Cache-Control': 'no-cache' } }
  );
  expect(res.ok(), `GET /receivables/summary failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const summary = (await res.json()) as ReceivableBalanceSummary;
  return Number(summary.totalOutstanding);
}

/** Finds an active credit-enabled customer (excluding the walk-in id=1), or creates one via the UI. */
async function findOrCreateCreditCustomer(page: Page): Promise<{ id: number; name: string }> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiRoot}/customers`, { headers });
  expect(res.ok(), `GET /customers failed: ${res.status()}`).toBeTruthy();
  const customers = (await res.json()) as Customer[];

  const existing = customers.find(
    (c) => c.id !== 1 && c.status !== 'INACTIVE' && c.creditActive === true
  );
  if (existing) return { id: existing.id, name: existing.name };

  const fake = fakerDataService.buildCustomerFake(Date.now());
  await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/customers(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nuevo cliente|new customer/i }).click();
  await expect(page.getByText(/nuevo cliente|new customer/i).first()).toBeVisible({ timeout: 20_000 });

  await page.getByLabel(/nombre completo|full name/i).fill(fake.name);
  await page.getByLabel(/email/i).fill(fake.email);
  await page.getByLabel(/tel[eé]fono|phone/i).fill(fake.phone);
  await page.getByLabel(/calle y n[uú]mero|street/i).fill(fake.street);
  await page.getByLabel(/ciudad|city/i).fill(fake.city);
  await page.getByLabel(/estado|provincia|state/i).fill(fake.state);

  await page.getByRole('checkbox', { name: /habilitar cr[eé]dito|credit enabled/i }).click();
  await expect(page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i)).toBeVisible({ timeout: 10_000 });
  await page.getByLabel(/l[ií]mite de cr[eé]dito|credit limit/i).fill('5000');
  await page.getByLabel(/plazo .*d[ií]as|credit term/i).fill('30');

  const createResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/customers'),
    { timeout: 20_000 }
  );
  await page.getByRole('button', { name: /guardar|save/i }).last().click();
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

async function openShiftIfPrompted(page: Page): Promise<void> {
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
async function selectPosCustomer(page: Page, customerName: string): Promise<void> {
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

/** Confirms a credit sale with no initial payment and returns the created sale total. */
async function makeCreditSale(page: Page, productName: string): Promise<number> {
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
  const sale = (await saleResponse.json()) as { total: number };

  await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

  return Number(sale.total);
}

/** Registers a payment against the customer's oldest debt (FIFO, the default allocation mode). */
async function registerCollectionPayment(
  page: Page,
  customerName: string,
  amount: number
): Promise<void> {
  await page.goto('/customer-collections', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/customer-collections(?:$|[?#])/i, { timeout: 20_000 });

  await page.getByRole('button', { name: /nueva cobranza/i }).click();

  await page.getByTestId('collection-customer-select').click();
  await page.getByRole('option', { name: new RegExp(customerName, 'i') }).click();

  await page.getByLabel(/^monto$/i).fill(String(amount));

  await page.getByLabel(/tipo de pago/i).click();
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('option').first().click();

  const collectionResponsePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/customer-collections'),
    { timeout: 20_000 }
  );
  await page.getByRole('button', { name: /crear cobranza/i }).click();
  const collectionResponse = await collectionResponsePromise;
  expect(collectionResponse.status(), await collectionResponse.text()).toBe(201);
}

test.describe('@real @manual @receivables-destructive', () => {
  test('@real @manual @receivables-destructive credit sale then a partial collection reduces the customer balance', async ({
    page,
  }) => {
    requireCredentialsOrSkip('credit sale + collection flow');

    const customer = await findOrCreateCreditCustomer(page);

    const productName = await getFirstSellableProduct(page);
    test.skip(!productName, 'No sellable product with stock available in the test tenant.');

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    await openShiftIfPrompted(page);

    const balanceBeforeSale = await getReceivableBalance(page, customer.id);

    await selectPosCustomer(page, customer.name);
    const saleTotal = await makeCreditSale(page, productName!);

    const balanceAfterSale = await getReceivableBalance(page, customer.id);
    expect(
      balanceAfterSale,
      `Balance should grow by the sale total (${saleTotal}). ` +
        `Before: ${balanceBeforeSale}, after: ${balanceAfterSale}.`
    ).toBeCloseTo(balanceBeforeSale + saleTotal, 1);

    // Pay half the sale so the balance check exercises a real partial payment, not just a full clear.
    const paymentAmount = Math.round((saleTotal / 2) * 100) / 100;
    await registerCollectionPayment(page, customer.name, paymentAmount);

    const balanceAfterPayment = await getReceivableBalance(page, customer.id);
    expect(
      balanceAfterPayment,
      `Balance should shrink by the payment (${paymentAmount}). ` +
        `Before payment: ${balanceAfterSale}, after: ${balanceAfterPayment}.`
    ).toBeCloseTo(balanceAfterSale - paymentAmount, 1);
  });
});
