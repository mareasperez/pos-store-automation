import { expect, type Page } from '@playwright/test';

import { config } from '@config';

export interface CreatedSaleSummary {
  id: number;
  saleNumber?: string;
  status?: string;
}

export async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
  const storageState = await page.context().storageState();
  const token = storageState.cookies.find((cookie) => cookie.name === 'access_token')?.value;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Cookie = `access_token=${token}`;
  }

  if (config.tenantId) {
    headers['X-Tenant-Id'] = config.tenantId;
  }

  return headers;
}

export async function getFirstSellableProduct(page: Page): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const stockResponse = await page.request.get(`${config.apiUrl}/api/inventory/stock-balance/all`, {
    headers,
  });

  if (!stockResponse.ok()) {
    return null;
  }

  const stockItems = (await stockResponse.json()) as { skuId: number; onHandQty: number }[];
  const candidates = stockItems
    .filter((stockItem) => stockItem.onHandQty > 0)
    .sort((left, right) => right.onHandQty - left.onHandQty);

  for (const candidate of candidates.slice(0, 5)) {
    const productResponse = await page.request.get(`${config.apiUrl}/api/products/${candidate.skuId}`, {
      headers,
    });

    if (!productResponse.ok()) {
      continue;
    }

    const product = (await productResponse.json()) as {
      active?: boolean;
      name?: string;
      sellableType?: string;
    };

    if (product.active === false) {
      continue;
    }
    if (product.sellableType && product.sellableType !== 'PRODUCT') {
      continue;
    }
    if (product.name) {
      return product.name;
    }
  }

  return null;
}

async function openShiftIfPrompted(page: Page): Promise<void> {
  const headers = await buildApiHeaders(page);
  const activeShiftResponse = await page.request.get(`${config.apiUrl}/api/shifts/active`, {
    headers,
  });

  if (activeShiftResponse.status() !== 200) {
    const openButton = page.locator('[data-testid="pos-open-shift"]:visible');
    await expect(openButton).toBeAttached({ timeout: 20_000 });
    await openButton.click();

    const cashInput = page.getByTestId('shift-initial-cash-input');
    await expect(cashInput).toBeVisible({ timeout: 8_000 });
    await cashInput.fill('1');

    const submitButton = page.getByTestId('shift-open-submit');
    await expect(submitButton).toBeEnabled({ timeout: 5_000 });
    await submitButton.click();
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

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const text = (await option.textContent()) ?? '';
    const lowerText = text.toLowerCase();
    const hasStock = !lowerText.includes('sin stock') && !lowerText.includes('out of stock');
    const matchesProduct = text.includes(productName.substring(0, 20));

    if (hasStock && matchesProduct) {
      await option.click();
      await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 10_000 });
      return;
    }
  }

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const text = ((await option.textContent()) ?? '').toLowerCase();

    if (!text.includes('sin stock') && !text.includes('out of stock')) {
      await option.click();
      await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 10_000 });
      return;
    }
  }

  await options.first().click();
  await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 10_000 });
}

export async function createSimpleCashSaleViaPos(
  page: Page,
  productName: string
): Promise<CreatedSaleSummary> {
  await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
  await addProductToCart(page, productName);
  await openShiftIfPrompted(page);

  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.getByTestId('pm-mode-simple')).toBeVisible({ timeout: 10_000 });

  const totalText = await page.locator('[class*="total"]').last().textContent();
  const totalAmount = totalText?.replace(/[^\d.]/g, '') ?? '10.00';
  await page.locator('input[type="number"]').first().fill(totalAmount);

  const saleResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/api/sales') && response.request().method() === 'POST',
    { timeout: 20_000 }
  );
  await page.getByTestId('pm-finalize').click();

  const saleResponse = await saleResponsePromise;
  expect(saleResponse.status()).toBe(201);

  const sale = (await saleResponse.json()) as CreatedSaleSummary;
  await page.getByTestId('invoice-close').click();
  await expect(page.getByTestId('invoice-dialog')).not.toBeVisible({ timeout: 5_000 });

  return sale;
}