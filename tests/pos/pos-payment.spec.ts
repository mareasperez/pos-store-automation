/**
 * PaymentManager E2E — simple-mode and advanced-mode real sales flows.
 *
 * Prerequisites (in the TEST_TENANT_ID tenant):
 *  - At least one active product with stock available
 *  - CASH and CARD payment methods active in NIO
 *  - A shift can be opened from the POS UI
 *
 * These tests create real sale records in the test tenant.
 */
import { expect, test, type Page } from '@playwright/test';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

// ── helpers ──────────────────────────────────────────────────────────────────

async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
  const storageState = await page.context().storageState();
  const token = storageState.cookies.find((c) => c.name === 'access_token')?.value;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Cookie = `access_token=${token}`;
  }
  if (config.tenantId) headers['X-Tenant-Id'] = config.tenantId;
  return headers;
}

/** Returns the name of the first active product with stock > 0, or null. */
async function getFirstSellableProduct(page: Page): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiUrl}/api/products?active=true&limit=10`, { headers });
  if (!res.ok()) return null;
  const body = await res.json();
  const items = Array.isArray(body) ? body : body.content ?? body.data ?? [];
  const product = items.find((p: { stock?: number; name?: string }) => (p.stock ?? 1) > 0);
  return product?.name ?? null;
}

/** Opens the shift from the POS page if the "Abrir Caja" button is visible. */
async function openShiftIfPrompted(page: Page): Promise<void> {
  // API check first — avoid UI interaction if shift is already open
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiUrl}/api/shifts/active`, { headers });
  if (res.status() === 200) return;

  const openBtn = page.locator('[data-testid="pos-open-shift"]:visible');
  await expect(openBtn).toBeAttached({ timeout: 20_000 });

  await openBtn.click();
  const cashInput = page.getByTestId('shift-initial-cash-input');
  await expect(cashInput).toBeVisible({ timeout: 8_000 });
  await cashInput.fill('1');
  const submitBtn = page.getByTestId('shift-open-submit');
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeAttached({ timeout: 20_000 });
}

/** Adds the given product to the POS cart by searching in the product entry field. */
async function addProductToCart(page: Page, productName: string): Promise<void> {
  const searchInput = page.getByTestId('pos-product-search');
  await searchInput.fill(productName.substring(0, 10));
  // Pick first result from autocomplete
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  // Confirm the product appeared in the cart
  await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 10_000 });
}

/** Opens the payment modal via Confirm Sale → Pay Now. */
async function openPaymentModal(page: Page): Promise<void> {
  await openShiftIfPrompted(page);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('@regression @pos @payment-manager @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser }) => {
    requireCredentialsOrSkip('PaymentManager POS flows');
    if (!config.tenantId) {
      console.warn('[E2E] TEST_TENANT_ID not set — skipping POS payment tests.');
      return;
    }
    // Resolve a sellable product once for all tests in this suite
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const p = await ctx.newPage();
    productName = await getFirstSellableProduct(p);
    await ctx.close();

    if (!productName) {
      console.warn('[E2E] No sellable product found in tenant — tests will be skipped.');
    }
  });

  test.beforeEach(async ({ page }) => {
    requireCredentialsOrSkip('PaymentManager POS flows');
    if (!productName) {
      test.skip(true, 'No sellable product available in the test tenant.');
    }
    await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
    await addProductToCart(page, productName!);
  });

  // ── Simple mode (single CASH payment) ────────────────────────────────────

  test('simple-mode cash payment completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Should be in simple mode by default
    await expect(page.getByTestId('pm-mode-simple')).toBeVisible();

    // Enter tendered amount equal to total
    const totalText = await page.locator('[class*="total"]').last().textContent();
    const totalAmount = totalText?.replace(/[^\d.]/g, '') ?? '10.00';

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(totalAmount);

    // Confirm sale
    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    const saleBody = (await saleResponse.json()) as { id?: number; total?: number; customerName?: string };

    // PaymentManager closes, invoice dialog opens
    await expect(page.getByTestId('pm-dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
    await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

    return saleBody.id;
  });

  test('sale appears in history with correct product and total', async ({ page }) => {
    const headers = await buildApiHeaders(page);
    await openPaymentModal(page);

    await expect(page.getByTestId('pm-mode-simple')).toBeVisible();
    const totalText = await page.locator('[class*="total"]').last().textContent();
    const expectedTotal = totalText?.replace(/[^\d.]/g, '') ?? '0';

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(expectedTotal);

    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;
    expect(saleResponse.status()).toBe(201);
    const sale = (await saleResponse.json()) as { id: number; total: number; customerName?: string; lines?: { productName?: string; quantity?: number; unitPrice?: number }[] };

    await page.getByTestId('invoice-close').click();

    // Verify in history API
    const histRes = await page.request.get(`${config.apiUrl}/api/sales/${sale.id}`, { headers });
    expect(histRes.status()).toBe(200);
    const detail = await histRes.json() as typeof sale;

    expect(detail.id).toBe(sale.id);
    expect(Number(detail.total)).toBeCloseTo(Number(expectedTotal), 1);
    expect(detail.lines?.length).toBeGreaterThan(0);
    const line = detail.lines![0];
    expect(line.productName).toBeTruthy();
    expect(Number(line.quantity)).toBeGreaterThan(0);
    expect(Number(line.unitPrice)).toBeGreaterThan(0);
  });

  // ── Advanced mode (split payment: cash + card) ────────────────────────────

  test('advanced-mode split payment across two methods completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Switch to advanced mode
    await page.getByTestId('pm-mode-advanced').click();
    await expect(page.getByRole('button', { name: /agregar pago|add payment/i })).toBeVisible({ timeout: 5_000 });

    // Add a partial CASH payment (half the total, approx)
    const cashMethodBtn = page.getByRole('button', { name: /efectivo|cash/i }).first();
    await cashMethodBtn.click();

    const amountInput = page.locator('input[type="number"]').first();
    const totalText = await page.locator('[class*="total"]').last().textContent();
    const total = parseFloat(totalText?.replace(/[^\d.]/g, '') ?? '10');
    const half = (total / 2).toFixed(2);

    await amountInput.fill(half);
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    // Add remaining via CARD
    const cardMethodBtn = page.getByRole('button', { name: /tarjeta|card/i }).first();
    await cardMethodBtn.click();
    // Amount should auto-fill the remaining
    await page.getByRole('button', { name: /agregar pago|add payment/i }).click();

    // Confirm sale
    const saleResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/sales') && r.request().method() === 'POST',
      { timeout: 20_000 }
    );
    await page.getByTestId('pm-finalize').click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    await expect(page.getByTestId('pm-dialog')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('invoice-close').click();
    await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });
  });
});
