import { test } from '@playwright/test';
import { fakerDataService } from '../../../services/fakerDataService';
import {
  assertProductVisibleInCatalog,
  assertProductVisibleInInventory,
  createProductWithInitialStock,
  requireCredentialsOrSkip,
} from '../../../support/catalog/products/helpers';

test('@regression @products @manual creates a standard product and shows it in catalog', async ({ page }) => {
  requireCredentialsOrSkip();

  const product = fakerDataService.buildProductFake(Date.now(), 'catalog');

  const createdProduct = await createProductWithInitialStock(
    page,
    product.name,
    product.sku,
    product.initialStock
  );

  await assertProductVisibleInCatalog(page, createdProduct);
});

test('@regression @products @manual creates a standard product and shows it in inventory', async ({ page }) => {
  requireCredentialsOrSkip();

  const product = fakerDataService.buildProductFake(Date.now(), 'inventory');

  const createdProduct = await createProductWithInitialStock(
    page,
    product.name,
    product.sku,
    product.initialStock
  );

  await assertProductVisibleInInventory(page, createdProduct);
});