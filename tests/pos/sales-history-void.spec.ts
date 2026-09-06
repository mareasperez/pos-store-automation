import { expect, test } from '@playwright/test';

import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  buildApiHeaders,
  createSimpleCashSaleViaPos,
  getFirstSellableProduct,
} from '../../support/flows/sales.flow';

test.describe('@regression @pos @sales-history @void @manual', () => {
  let productName: string | null = null;

  test.beforeAll(async ({ browser }) => {
    requireCredentialsOrSkip('sales history void flow');

    if (!config.tenantId) {
      console.warn('[E2E] TEST_TENANT_ID not set — skipping sales history void tests.');
      return;
    }

    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    productName = await getFirstSellableProduct(page);
    await context.close();

    if (!productName) {
      console.warn('[E2E] No sellable product found in tenant — tests will be skipped.');
    }
  });

  test.beforeEach(() => {
    requireCredentialsOrSkip('sales history void flow');

    if (!productName) {
      test.skip(true, 'No sellable product available in the test tenant.');
    }
  });

  test('void action optimistically marks the selected sale as cancelled', async ({ page }) => {
    const createdSale = await createSimpleCashSaleViaPos(page, productName!);
    const headers = await buildApiHeaders(page);

    await page.goto('/sales-history?lng=es', { waitUntil: 'networkidle' });

    const saleIdentifier = createdSale.saleNumber ?? String(createdSale.id);
    const searchInput = page.getByTestId('sales-history-search');
    await searchInput.fill(saleIdentifier);

    const saleRow = page.locator('tbody tr').first();
    await expect(saleRow).toContainText('COMPLETED', { timeout: 15_000 });

    let releaseVoidResponse: () => void = () => {};
    const releaseGate = new Promise<void>((resolve) => {
      releaseVoidResponse = resolve;
    });
    let voidRequestSeen: () => void = () => {};
    const voidRequestStarted = new Promise<void>((resolve) => {
      voidRequestSeen = resolve;
    });

    await page.route(`**/api/sales/${createdSale.id}/void`, async (route) => {
      voidRequestSeen();
      const response = await route.fetch();
      const body = await response.body();

      await releaseGate;
      await route.fulfill({ response, body });
    });

    await page.getByTestId(`sale-actions-${createdSale.id}`).click();
    await page.getByTestId(`sale-void-${createdSale.id}`).click();
    await expect(page.getByTestId('void-sale-dialog')).toBeVisible();

    const voidResponsePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/sales/${createdSale.id}/void`),
      { timeout: 20_000 }
    );
    await page.getByTestId('void-sale-confirm').click();

    await voidRequestStarted;
    await expect(saleRow).toContainText('CANCELLED');
    await expect(page.getByTestId(`sale-actions-${createdSale.id}`)).toHaveCount(0);

    releaseVoidResponse();

    const voidResponse = await voidResponsePromise;
    expect(voidResponse.status()).toBe(200);

    const saleResponse = await page.request.get(`${config.apiRoot}/sales/${createdSale.id}`, {
      headers,
    });
    expect(saleResponse.status()).toBe(200);
    const persistedSale = (await saleResponse.json()) as { id: number; status: string };
    expect(persistedSale.status).toBe('CANCELLED');
  });
});