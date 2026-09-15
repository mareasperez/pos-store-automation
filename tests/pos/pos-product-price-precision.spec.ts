/**
 * Real POS coverage for catalog prices with non-round cents.
 *
 * Each test creates the product through the catalog UI, sells one unit through the POS UI, and
 * verifies that the API preserves the exact two-decimal product price and sale total.
 */
import { expect, test } from '@fixtures';
import { fakerDataService } from '../../services/fakerDataService';
import {
  createProductWithInitialStock,
  requireCredentialsOrSkip,
} from '../../support/flows/products.flow';
import { addProductToCart } from '../../support/flows/sales.flow';
import { openPaymentModal } from '../../support/flows/payment.flow';
import { assertShiftStillActive } from '../../utils/shift';

const priceCases = [
  { label: '100.01', price: '100.01' },
  { label: '99.99', price: '99.99' },
  { label: '88.87', price: '88.87' },
];

test.describe('@regression @pos @product-price-precision @manual', () => {
  for (const priceCase of priceCases) {
    test(`sells a product priced at ${priceCase.label} without losing cents`, async ({ page }) => {
      requireCredentialsOrSkip();

      const product = fakerDataService.buildProductFake(
        Date.now() + Number(priceCase.price.replace('.', '')),
        'standard',
        `price-${priceCase.label.replace('.', '-')}`
      );
      const createdProduct = await createProductWithInitialStock(
        page,
        product.name,
        product.sku,
        '1',
        priceCase.price,
        '1.00'
      );

      await page.goto('/pos?lng=es', { waitUntil: 'networkidle' });
      await addProductToCart(page, createdProduct.name);

      await expect(page.getByTestId('pos-cart-total')).toContainText(priceCase.price);

      await openPaymentModal(page);
      await expect(page.getByTestId('pm-total-base')).toContainText(priceCase.price);
      await page.locator('input[type="number"]').first().fill(priceCase.price);

      const saleResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/sales') && response.request().method() === 'POST',
        { timeout: 20_000 }
      );
      await assertShiftStillActive(page);
      await page.getByTestId('pm-finalize').click();
      const saleResponse = await saleResponsePromise;

      expect(saleResponse.status(), await saleResponse.text()).toBe(201);
      const sale = (await saleResponse.json()) as {
        total: number;
        lines?: Array<{ presentationPrice?: number; quantity?: number }>;
      };

      expect(sale.total).toBe(Number(priceCase.price));
      expect(sale.lines?.[0]?.presentationPrice).toBe(Number(priceCase.price));
      expect(sale.lines?.[0]?.quantity).toBe(1);

      await expect(page.getByTestId('invoice-dialog')).toBeVisible({ timeout: 5_000 });
      await page.getByTestId('invoice-close').click();
    });
  }
});
