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

/** Ensures the shift is open; opens it via the UI if not. */
async function ensureShiftOpen(page: Page): Promise<void> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiUrl}/api/shifts/active`, { headers });
  if (res.status() === 200) return; // already open

  // No active shift — open one via the UI
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
  const openBtn = page.getByRole('button', { name: /abrir caja|open shift/i });
  if (await openBtn.isVisible({ timeout: 8_000 })) {
    await openBtn.click();
    // Enter 0 initial cash and confirm
    const cashInput = page.getByLabel(/efectivo inicial|initial cash/i);
    if (await cashInput.isVisible({ timeout: 5_000 })) {
      await cashInput.fill('0');
    }
    await page.getByRole('button', { name: /abrir|open|confirmar|confirm/i }).last().click();
    await expect(page.getByRole('button', { name: /abrir caja|open shift/i })).not.toBeVisible({ timeout: 15_000 });
  }
}

/** Adds the given product to the POS cart by searching in the product entry field. */
async function addProductToCart(page: Page, productName: string): Promise<void> {
  const searchInput = page.getByPlaceholder(/buscar producto|search product|sku|barcode/i).first();
  await searchInput.fill(productName.substring(0, 10));
  // Pick first result from autocomplete
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  // Confirm the product appeared in the cart
  await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 10_000 });
}

/** Opens the payment modal (Pay Now button). */
async function openPaymentModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: /pay now|cobrar|pagar/i }).click();
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
    await ensureShiftOpen(page);
    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    await addProductToCart(page, productName!);
  });

  // ── Simple mode (single CASH payment) ────────────────────────────────────

  test('simple-mode cash payment completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Should be in simple mode by default
    await expect(page.getByRole('button', { name: /modo simple|simple mode/i })).toBeVisible();

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
    await page.getByRole('button', { name: /cobrar|confirm|pay/i }).click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    // Modal should close and POS resets
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10_000 });
  });

  // ── Advanced mode (split payment: cash + card) ────────────────────────────

  test('advanced-mode split payment across two methods completes the sale', async ({ page }) => {
    await openPaymentModal(page);

    // Switch to advanced mode
    await page.getByRole('button', { name: /modo avanzado|advanced mode/i }).click();
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
    await page.getByRole('button', { name: /cobrar|confirm|pay/i }).click();
    const saleResponse = await saleResponsePromise;

    expect(saleResponse.status()).toBe(201);
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10_000 });
  });
});
