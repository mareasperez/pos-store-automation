import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { buildApiHeaders } from './sales.flow';

export interface CustomerDebtSummary {
  customerId: number;
  customerName: string | null;
  totalOutstanding: number;
  openReceivablesCount: number;
}

interface PageResponse<T> {
  content: T[];
}

interface ReceivableBalanceSummary {
  customerId: number;
  totalOutstanding: number;
  hasOutstandingBalance: boolean;
}

/** Reads a customer's current outstanding balance straight from the API. */
export async function getReceivableBalance(page: Page, customerId: number): Promise<number> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(
    `${config.apiRoot}/receivables/summary?customerId=${customerId}`,
    { headers: { ...headers, 'Cache-Control': 'no-cache' } }
  );
  expect(
    res.ok(),
    `GET /receivables/summary failed: ${res.status()} ${await res.text()}`
  ).toBeTruthy();
  const summary = (await res.json()) as ReceivableBalanceSummary;
  return Number(summary.totalOutstanding);
}

/**
 * Finds an existing customer with a pending balance in the test tenant, preferring the one with
 * the fewest open receivables — other specs (e.g. credit-sale-and-collection) keep reusing and
 * growing one "regular" test customer, and a huge pending-sales table risks overlapping the
 * dialog footer. Returns null if no customer has any outstanding balance.
 */
export async function findExistingDebtor(page: Page): Promise<CustomerDebtSummary | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(
    `${config.apiRoot}/receivables/customers-summary?page=0&size=50`,
    { headers }
  );
  expect(res.ok(), `GET /receivables/customers-summary failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as PageResponse<CustomerDebtSummary>;
  const debtors = body.content.filter((row) => row.totalOutstanding > 0 && row.customerName);
  if (!debtors.length) return null;
  return debtors.reduce((smallest, row) =>
    row.openReceivablesCount < smallest.openReceivablesCount ? row : smallest
  );
}

/** Registers a payment against the customer's oldest debt (FIFO, the default allocation mode). */
export async function registerCollectionPayment(
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
