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

  // stock-balance/all returns all products with available stock across warehouses
  const stockRes = await page.request.get(
    `${config.apiUrl}/api/inventory/stock-balance/all`,
    { headers }
  );
  if (!stockRes.ok()) return null;
  const stockItems = await stockRes.json() as { skuId: number; onHandQty: number }[];

  // Try candidates in order of descending stock to pick the most available one
  const candidates = stockItems
    .filter((s) => s.onHandQty > 0)
    .sort((a, b) => b.onHandQty - a.onHandQty);

  for (const candidate of candidates.slice(0, 5)) {
    const productRes = await page.request.get(
      `${config.apiUrl}/api/products/${candidate.skuId}`,
      { headers }
    );
    if (!productRes.ok()) continue;
    const product = await productRes.json() as { name?: string; active?: boolean; sellableType?: string };
    // Only PRODUCT type sellables are sold in POS (not SERVICE or GENERIC_CHARGE)
    if (product.active === false) continue;
    if (product.sellableType && product.sellableType !== 'PRODUCT') continue;
    if (product.name) return product.name;
  }

  return null;
}

/** Opens the shift from the POS page if the "Abrir Caja" button is visible. */
async function openShiftIfPrompted(page: Page): Promise<void> {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(`${config.apiUrl}/api/shifts/active`, { headers });

  if (res.status() !== 200) {
    const openBtn = page.locator('[data-testid="pos-open-shift"]:visible');
    await expect(openBtn).toBeAttached({ timeout: 20_000 });

    await openBtn.click();
    const cashInput = page.getByTestId('shift-initial-cash-input');
    await expect(cashInput).toBeVisible({ timeout: 8_000 });
    await cashInput.fill('1');
    const submitBtn = page.getByTestId('shift-open-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();
  }

  // Always wait for the POS to be ready, regardless of whether the shift was just opened or already active
  await expect(page.locator('[data-testid="pos-confirm-sale"]:visible')).toBeAttached({ timeout: 20_000 });
}

/** Adds the given product to the POS cart by searching in the product entry field. */
async function addProductToCart(page: Page, productName: string): Promise<void> {
  const searchInput = page.getByTestId('pos-product-search');
  // Use enough characters to narrow results to this specific product
  await searchInput.fill(productName.substring(0, 30));

  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
  const options = page.getByRole('option');
  const count = await options.count();

  // Prefer the option that matches the product name and has stock
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const text = (await option.textContent()) ?? '';
    const lower = text.toLowerCase();
    const hasStock = !lower.includes('sin stock') && !lower.includes('out of stock');
    const matchesProduct = text.includes(productName.substring(0, 20));
    if (hasStock && matchesProduct) {
      await option.click();
      clicked = true;
      break;
    }
  }
  // Fallback: any option with stock
  if (!clicked) {
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const text = (await option.textContent()) ?? '';
      if (!text.toLowerCase().includes('sin stock') && !text.toLowerCase().includes('out of stock')) {
        await option.click();
        clicked = true;
        break;
      }
    }
  }
  if (!clicked) await options.first().click();

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
    const sale = (await saleResponse.json()) as { id: number; total: number; customerName?: string; lines?: { productName?: string; quantity?: number; presentationPrice?: number }[] };

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
    expect(Number(line.presentationPrice)).toBeGreaterThan(0);
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
