import { expect, type Page } from '@playwright/test';

import { config } from '@config';

export interface CreatedSaleLineSummary {
  productId: number;
  presentationId: number;
  quantity: number;
}

export interface CreatedSaleSummary {
  id: number;
  saleNumber?: string;
  status?: string;
  lines?: CreatedSaleLineSummary[];
}

export interface SellableProductStock {
  skuId: number;
  name: string;
  onHandQty: number;
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
  const stock = await getFirstSellableProductWithStock(page);
  return stock?.name ?? null;
}

/** Same lookup as {@link getFirstSellableProduct} but also returns the skuId and on-hand qty. */
export async function getFirstSellableProductWithStock(
  page: Page
): Promise<SellableProductStock | null> {
  const headers = await buildApiHeaders(page);
  const stockResponse = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, {
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
    const productResponse = await page.request.get(
      `${config.apiRoot}/products/${candidate.skuId}`,
      {
        headers,
      }
    );

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
      return { skuId: candidate.skuId, name: product.name, onHandQty: candidate.onHandQty };
    }
  }

  return null;
}

/** Reads a single product's current on-hand stock (aggregated across warehouses). */
export async function getProductStock(page: Page, skuId: number): Promise<number> {
  const headers = await buildApiHeaders(page);
  const stockResponse = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, {
    headers,
  });
  expect(
    stockResponse.ok(),
    `GET /inventory/stock-balance/all failed: ${stockResponse.status()}`
  ).toBeTruthy();

  const stockItems = (await stockResponse.json()) as { skuId: number; onHandQty: number }[];
  return stockItems.find((item) => item.skuId === skuId)?.onHandQty ?? 0;
}

/** Reads a presentation's conversion factor to base units (1 for the base presentation itself). */
export async function getPresentationConversionFactor(
  page: Page,
  productId: number,
  presentationId: number
): Promise<number> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/product-presentations`, {
    headers,
    params: { productId },
  });
  expect(
    response.ok(),
    `GET /product-presentations?productId=${productId} failed: ${response.status()}`
  ).toBeTruthy();

  const presentations = (await response.json()) as Array<{ id: number; conversionFactor: number }>;
  const matched = presentations.find((presentation) => presentation.id === presentationId);
  expect(matched, `Presentation ${presentationId} not found for product ${productId}`).toBeTruthy();
  return Number(matched!.conversionFactor);
}

export interface NonBasePresentationCandidate {
  skuId: number;
  productName: string;
  presentationId: number;
  presentationName: string;
  conversionFactor: number;
}

/**
 * Finds a sellable product that has a non-base presentation (e.g. "Caja x12", factor > 1) with
 * enough base-unit stock to sell at least one unit of it. Returns null when the test tenant has
 * no such product — callers should `test.skip` in that case instead of failing.
 */
export async function findProductWithNonBasePresentation(
  page: Page
): Promise<NonBasePresentationCandidate | null> {
  const headers = await buildApiHeaders(page);

  const presentationsResponse = await page.request.get(`${config.apiRoot}/product-presentations`, {
    headers,
  });
  if (!presentationsResponse.ok()) {
    return null;
  }

  const presentations = (await presentationsResponse.json()) as Array<{
    id: number;
    productId: number;
    productName?: string;
    presentationTypeName?: string;
    conversionFactor: number;
    active?: boolean;
    isBasePresentation?: boolean;
  }>;

  const nonBaseCandidates = presentations.filter(
    (presentation) =>
      presentation.active !== false &&
      !presentation.isBasePresentation &&
      Number(presentation.conversionFactor) > 1
  );
  if (!nonBaseCandidates.length) {
    return null;
  }

  const stockResponse = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, {
    headers,
  });
  if (!stockResponse.ok()) {
    return null;
  }
  const stockItems = (await stockResponse.json()) as { skuId: number; onHandQty: number }[];
  const baseStockBySkuId = new Map(stockItems.map((item) => [item.skuId, item.onHandQty]));

  for (const candidate of nonBaseCandidates) {
    const factor = Number(candidate.conversionFactor);
    const baseStock = baseStockBySkuId.get(candidate.productId) ?? 0;
    if (baseStock < factor || !candidate.productName || !candidate.presentationTypeName) {
      continue;
    }

    const productResponse = await page.request.get(
      `${config.apiRoot}/products/${candidate.productId}`,
      { headers }
    );
    if (!productResponse.ok()) {
      continue;
    }
    const product = (await productResponse.json()) as {
      active?: boolean;
      sellableType?: string;
    };
    if (product.active === false) {
      continue;
    }
    if (product.sellableType && product.sellableType !== 'PRODUCT') {
      continue;
    }

    return {
      skuId: candidate.productId,
      productName: candidate.productName,
      presentationId: candidate.id,
      presentationName: candidate.presentationTypeName,
      conversionFactor: factor,
    };
  }

  return null;
}

async function openShiftIfPrompted(page: Page): Promise<void> {
  const headers = await buildApiHeaders(page);
  const activeShiftResponse = await page.request.get(`${config.apiRoot}/shifts/active`, {
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

async function addProductToCart(
  page: Page,
  productName: string,
  presentationName?: string
): Promise<void> {
  const searchInput = page.getByTestId('pos-product-search');
  await searchInput.fill(productName.substring(0, 30));

  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10_000 });
  const options = page.getByRole('option');
  const count = await options.count();

  if (presentationName) {
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      const text = (await option.textContent()) ?? '';
      const lowerText = text.toLowerCase();
      const hasStock = !lowerText.includes('sin stock') && !lowerText.includes('out of stock');
      const matchesProduct = text.includes(productName.substring(0, 20));
      const matchesPresentation = text.includes(presentationName);

      if (hasStock && matchesProduct && matchesPresentation) {
        await option.click();
        await expect(page.getByText(productName, { exact: false })).toBeVisible({
          timeout: 10_000,
        });
        return;
      }
    }
    throw new Error(
      `No option matched product "${productName}" with presentation "${presentationName}" and stock.`
    );
  }

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
  productName: string,
  presentationName?: string
): Promise<CreatedSaleSummary> {
  await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
  await addProductToCart(page, productName, presentationName);
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
