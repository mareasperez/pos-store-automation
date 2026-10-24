/**
 * Quote (proforma) lifecycle: create a quote in the UI, sell it as-is from the POS with the normal
 * checkout, and prove the server built the sale from the quote (quoteId, no client lines, same
 * total), linked both, deducted stock from the quote warehouse, and refuses to sell it again.
 */
import { expect, serialDescribe, test } from '@fixtures';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import {
  cancelQuoteViaApi,
  createQuoteViaApi,
  findActiveCustomer,
  findStockWarehouse,
  findStockedProductInWarehouse,
  getQuote,
  getWarehouseStock,
  type QuoteSummary,
} from '../../support/flows/quotes.flow';
import { createProductWithInitialStock } from '../../support/flows/products.flow';
import { getPresentationConversionFactor } from '../../support/flows/sales.flow';
import { openShiftIfPrompted } from '../../utils/shift';

test.setTimeout(120_000);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

serialDescribe('@regression @pos @quotes', () => {
  test('@regression @pos @quotes @serial creates a quote in the UI and sells it as-is from the POS', async ({
    page,
  }) => {
    requireCredentialsOrSkip('Quote to sale flow');

    const product = await findStockedProductInWarehouse(page);
    test.skip(!product, 'No sellable product with stock in a single warehouse.');
    const customer = await findActiveCustomer(page);
    test.skip(!customer, 'No active customer in the test tenant.');

    const stockBefore = await getWarehouseStock(page, product!.skuId, product!.warehouseId);
    const chargeName = `Envio E2E ${Date.now()}`;

    // --- Create the quote in the UI ---
    await page.goto('/quotes?lng=es', { waitUntil: 'networkidle' });
    await page.getByTestId('quotes-new').click();

    // The list only opens once the dialog finished opening and customers loaded, so retry the
    // click until an option shows instead of relying on fixed sleeps.
    const customerInput = page.getByTestId('quote-form-customer');
    await expect(customerInput).not.toHaveAttribute('placeholder', /cargando/i, {
      timeout: 15_000,
    });
    await expect(async () => {
      await customerInput.click();
      await expect(page.getByRole('option').first()).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await customerInput.pressSequentially(customer!.name.substring(0, 8), { delay: 30 });
    await page.getByRole('option', { name: customer!.name, exact: true }).first().click();
    await expect(customerInput).toHaveValue(customer!.name);

    await page.getByTestId('quote-form-warehouse').click();
    await page.getByRole('option', { name: product!.warehouseName, exact: true }).click();

    await page.getByTestId('quote-add-item').click();
    await page.getByTestId('product-search-modal-input').fill(product!.name.substring(0, 30));
    await page.getByTestId(`product-card-${product!.skuId}-${product!.presentationId}`).click();

    const productLine = page
      .getByTestId('quote-form-line')
      .filter({ hasText: new RegExp(escapeRegExp(product!.name)) })
      .first();
    await expect(productLine).toBeVisible();
    await productLine.getByTestId('quote-line-quantity').fill('2');

    await page.getByTestId('quote-add-charge').click();
    await page.getByTestId('quote-charge-name').fill(chargeName);
    await page.getByTestId('quote-charge-price').fill('25');
    await page.getByTestId('quote-charge-confirm').click();
    await expect(page.getByTestId('quote-form-line').filter({ hasText: chargeName })).toBeVisible();

    const createResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/quotes$/.test(new URL(r.url()).pathname)
    );
    await page.getByTestId('quote-form-save').click();
    const createdResponse = await createResponse;
    expect(createdResponse.status(), await createdResponse.text()).toBe(201);
    const quote = (await createdResponse.json()) as QuoteSummary;

    expect(quote.status).toBe('OPEN');
    expect(quote.customerId).toBe(customer!.id);
    expect(quote.warehouseId).toBe(product!.warehouseId);
    expect(quote.createdByName, 'the quote records who created it').toBeTruthy();
    await expect(page.getByTestId('quote-detail-attended-by')).toHaveText(quote.createdByName!);
    const quotedProduct = quote.lines.find(
      (line) => line.productId === product!.skuId && line.sellableType === 'PRODUCT'
    );
    expect(quotedProduct?.quantity).toBe(2);
    expect(quotedProduct?.presentationId).toBe(product!.presentationId);
    expect(quote.lines.find((line) => line.sellableType === 'GENERIC_CHARGE')?.productName).toBe(
      chargeName
    );

    // --- Sell it from the quote detail ---
    await page.getByTestId('quote-detail-sell').click();
    await expect(page).toHaveURL(new RegExp(`/pos\\?quoteId=${quote.id}`));
    await expect(page.getByTestId('pos-quote-panel')).toContainText(quote.quoteNumber);

    await openShiftIfPrompted(page);
    await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
    await page.getByTestId('pos-pay-now').click();
    await expect(page.getByTestId('pm-mode-simple')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('payment-amount-input').fill(quote.total.toFixed(2));

    const saleRequest = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/api\/sales$/.test(new URL(r.url()).pathname)
    );
    const saleResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/sales$/.test(new URL(r.url()).pathname),
      { timeout: 20_000 }
    );
    await page.getByTestId('pm-finalize').click();

    const salePayload = (await saleRequest).postDataJSON() as {
      quoteId?: number;
      customerId: number;
      warehouseId: number;
      lines: unknown[];
    };
    expect(salePayload).toMatchObject({
      quoteId: quote.id,
      customerId: customer!.id,
      warehouseId: product!.warehouseId,
      lines: [],
    });

    const saleResult = await saleResponse;
    expect(saleResult.status(), await saleResult.text()).toBe(201);
    const sale = (await saleResult.json()) as { id: number; total: number };
    expect(sale.total).toBeCloseTo(quote.total, 2);

    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('invoice-close').click();
    await expect(page).not.toHaveURL(/quoteId=/);
    await expect(page.getByTestId('pos-quote-panel')).toHaveCount(0);

    // --- Server side effects ---
    const soldQuote = await getQuote(page, quote.id);
    expect(soldQuote.status).toBe('SOLD');
    expect(soldQuote.saleId).toBe(sale.id);

    let expectedBaseUnits = 0;
    for (const line of quote.lines.filter((l) => l.productId === product!.skuId)) {
      const factor = await getPresentationConversionFactor(
        page,
        line.productId!,
        line.presentationId!
      );
      expectedBaseUnits += line.quantity * factor;
    }
    const stockAfter = await getWarehouseStock(page, product!.skuId, product!.warehouseId);
    expect(
      stockAfter,
      `Stock in warehouse ${product!.warehouseName} should drop by ${expectedBaseUnits}`
    ).toBeCloseTo(stockBefore - expectedBaseUnits, 5);

    // --- A sold quote cannot be sold again ---
    await page.goto(`/pos?quoteId=${quote.id}&lng=es`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('pos-quote-unavailable')).toBeVisible();
  });

  test('@regression @pos @quotes @serial a cancelled quote cannot be sold from the POS', async ({
    page,
  }) => {
    requireCredentialsOrSkip('Cancelled quote flow');

    const product = await findStockedProductInWarehouse(page);
    test.skip(!product, 'No sellable product with stock in a single warehouse.');
    const customer = await findActiveCustomer(page);
    test.skip(!customer, 'No active customer in the test tenant.');

    const quote = await createQuoteViaApi(page, {
      customerId: customer!.id,
      warehouseId: product!.warehouseId,
      productId: product!.skuId,
      quantity: 1,
    });
    const cancelled = await cancelQuoteViaApi(page, quote.id);
    expect(cancelled.status).toBe('CANCELLED');

    await page.goto(`/pos?quoteId=${quote.id}&lng=es`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('pos-quote-unavailable')).toBeVisible();

    await page.getByTestId('pos-quote-exit').click();
    await expect(page).not.toHaveURL(/quoteId=/);
    await expect(page.getByTestId('pos-product-search')).toBeVisible();
  });

  test('@regression @pos @quotes @serial a taxed product is quoted and sold at the same tax-inclusive total', async ({
    page,
  }) => {
    requireCredentialsOrSkip('Taxed quote to sale flow');

    const customer = await findActiveCustomer(page);
    test.skip(!customer, 'No active customer in the test tenant.');

    // A dedicated product so no real catalog data is changed: manual price 115 with 15% tax
    // included (net 100 + tax 15).
    const suffix = Date.now();
    const product = await createProductWithInitialStock(
      page,
      `E2E IVA ${suffix}`,
      `E2E-IVA-${suffix}`,
      '10',
      '115',
      '80',
      '15'
    );
    const stock = await findStockWarehouse(page, product.id);
    expect(stock, 'the initial stock lands in an active warehouse').toBeTruthy();

    const quote = await createQuoteViaApi(page, {
      customerId: customer!.id,
      warehouseId: stock!.warehouseId,
      productId: product.id,
      quantity: 2,
    });

    // Prices include tax: the quote charges 2 x 115 and only splits out the tax inside it.
    expect(quote.total).toBeCloseTo(230, 2);
    expect(quote.tax).toBeCloseTo(30, 2);
    expect(quote.subtotal).toBeCloseTo(200, 2);
    expect(quote.lines[0]).toMatchObject({ taxRate: 0.15, taxAmount: 30 });

    await page.goto(`/pos?quoteId=${quote.id}&lng=es`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('pos-quote-panel')).toContainText(quote.quoteNumber);
    await openShiftIfPrompted(page);
    await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
    await page.getByTestId('pos-pay-now').click();
    await expect(page.getByTestId('pm-mode-simple')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('payment-amount-input').fill(quote.total.toFixed(2));

    const saleResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/sales$/.test(new URL(r.url()).pathname),
      { timeout: 20_000 }
    );
    await page.getByTestId('pm-finalize').click();
    const saleResult = await saleResponse;
    expect(saleResult.status(), await saleResult.text()).toBe(201);
    const sale = (await saleResult.json()) as {
      id: number;
      subtotal: number;
      tax: number;
      total: number;
      items: Array<{ subtotal: number }>;
    };

    // The sale charges exactly the quoted total and reports the same included tax.
    expect(sale.total).toBeCloseTo(quote.total, 2);
    expect(sale.tax).toBeCloseTo(quote.tax, 2);
    expect(sale.subtotal).toBeCloseTo(quote.subtotal, 2);

    await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('invoice-dialog')).toContainText('230');
    await page.getByTestId('invoice-close').click();

    expect((await getQuote(page, quote.id)).status).toBe('SOLD');
  });
});
