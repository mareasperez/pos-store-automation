import { expect, test, type Page } from '@playwright/test';
import { config } from '@config';
import { fakerDataService } from '../services/fakerDataService';

type CreatedProductResponse = {
  id: number;
  name: string;
  sku: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireCredentialsOrSkip() {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run product edit flows.'
  );
}

/**
 * Creates a product via the UI and returns the created product data.
 */
async function createProduct(page: Page): Promise<CreatedProductResponse> {
  const product = fakerDataService.buildProductFake(Date.now(), 'edit-flow');

  await page.goto('/catalog/products/new', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/catalog\/products\/new(?:$|[?#])/i, { timeout: 20_000 });

  await page.locator('input[name="name"]').fill(product.name);
  await page.locator('input[name="sku"]').fill(product.sku);

  const stockInput = page.locator('input[name="stock"]');
  if (await stockInput.isVisible()) {
    await stockInput.fill(product.initialStock);
  }

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/products')
  );

  await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);

  return (await createResponse.json()) as CreatedProductResponse;
}

/**
 * Adds a secondary presentation via the editor modal.
 * conversionFactor must be greater than 1 (it can't be 1 — that's the base unit).
 * cost and price default to '100' and '150' so the Save button is enabled.
 * After this helper returns, the presentation is in LOCAL STATE only.
 * Call savePresentations() or save the whole form to persist it.
 */
async function addPresentationInEditForm(
  page: Page,
  conversionFactor: string,
  cost = '100',
  price = '150'
): Promise<void> {
  await page.getByRole('button', { name: /add presentation|agregar presentaci[oó]n/i }).click();

  // Scope to the presentation editor modal
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout: 10_000 });

  // Fill the factor input inside the modal
  const factorInput = modal.getByLabel(/factor|conversion factor/i);
  await expect(factorInput).toBeVisible({ timeout: 5_000 });
  await factorInput.fill(conversionFactor);

  // Fill cost and price — required for the Save button to be enabled
  const costInput = modal.getByLabel(/^costo$|^cost$/i);
  await costInput.fill(cost);

  const priceInput = modal.getByLabel(/^precio$|^price$/i);
  await priceInput.fill(price);

  // Click Save inside the modal (exact match avoids "Guardar Presentaciones" / "Guardar y salir")
  const saveButton = modal.getByRole('button', { name: /^save$|^guardar$/i });
  await expect(saveButton).toBeEnabled({ timeout: 5_000 });
  await saveButton.click();

  // Wait for the modal to close before returning
  await expect(modal).not.toBeVisible({ timeout: 5_000 });
}

/**
 * Persists the locally-staged presentations via the dedicated save button.
 * Returns once the POST to /api/product-presentations completes.
 */
async function savePresentations(page: Page): Promise<void> {
  const presentationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/product-presentations')
  );
  await page.getByRole('button', { name: /guardar presentaciones|save presentations/i }).click();
  const response = await presentationResponsePromise;
  expect(response.status()).toBeLessThan(300);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('@manual @products @edit product edit flow', () => {
  test('can navigate to edit page from product list', async ({ page }) => {
    requireCredentialsOrSkip();

    const created = await createProduct(page);

    // Navigate to catalog and find the product
    await page.goto('/catalog/products', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/cargando productos/i)).not.toBeVisible({ timeout: 20_000 });

    const search = page.getByPlaceholder(/buscar|search/i).first();
    await search.fill(created.name);

    const firstRow = page
      .getByRole('row', { name: new RegExp(escapeRegExp(created.name), 'i') })
      .first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });

    // Click row to open preview dialog
    await firstRow.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click edit button
    await dialog.getByRole('button', { name: /editar/i }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 10_000 });
  });

  test('adds a new presentation and saves product', async ({ page }) => {
    requireCredentialsOrSkip();

    const created = await createProduct(page);

    // Go directly to edit page
    await page.goto(`/catalog/products/${created.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 20_000 });

    // Add presentation with factor 17 (distinct from base=1 and other tests)
    await addPresentationInEditForm(page, '17');

    // Verify the new presentation row appears in the table before saving
    const tableRows = page.locator('tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(1);
    // Scope to the table to avoid matching factor in other page elements
    await expect(page.locator('tbody').getByText('17').first()).toBeVisible();

    // Persist presentations, then save the product
    await savePresentations(page);

    const updateResponsePromise = page.waitForResponse(
      (response) =>
        (response.request().method() === 'PUT' || response.request().method() === 'PATCH') &&
        response.url().includes('/api/products')
    );
    await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBeLessThan(300);
  });

  test('new presentation is visible in the preview dialog after edit', async ({ page }) => {
    requireCredentialsOrSkip();

    const created = await createProduct(page);

    // Edit the product and add a presentation
    await page.goto(`/catalog/products/${created.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 20_000 });

    await addPresentationInEditForm(page, '13');

    // Persist presentations first, then save the product — each has its own button
    await savePresentations(page);

    const updateResponsePromise = page.waitForResponse(
      (response) =>
        (response.request().method() === 'PUT' || response.request().method() === 'PATCH') &&
        response.url().includes('/api/products')
    );
    await page.getByRole('button', { name: /guardar y salir|save and exit/i }).click();
    await updateResponsePromise;

    await expect(page).toHaveURL(/\/catalog\/products(?:$|[?#])/i, { timeout: 20_000 });

    // Search for the product and open the preview dialog
    const search = page.getByPlaceholder(/buscar|search/i).first();
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(created.name);

    const productRow = page
      .getByRole('row', { name: new RegExp(escapeRegExp(created.name), 'i') })
      .first();
    await expect(productRow).toBeVisible({ timeout: 15_000 });
    await productRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The presentations table inside the dialog must show more than 1 row
    const presentationRows = dialog.locator('table tbody tr');
    await expect(presentationRows.first()).toBeVisible({ timeout: 10_000 });
    const count = await presentationRows.count();
    expect(count).toBeGreaterThan(1);

    // The conversion factor 13 must be visible in the presentations table
    await expect(presentationRows.filter({ hasText: '13' }).first()).toBeVisible();
  });

  test('edit page title reflects the product being edited', async ({ page }) => {
    requireCredentialsOrSkip();

    const created = await createProduct(page);

    await page.goto(`/catalog/products/${created.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 20_000 });

    // The product name is pre-filled after the API call returns — toHaveValue retries automatically
    await expect(page.locator('#name')).toHaveValue(created.name, { timeout: 20_000 });
  });

  test('cannot save duplicate presentation (same type + same factor)', async ({ page }) => {
    requireCredentialsOrSkip();

    const created = await createProduct(page);

    await page.goto(`/catalog/products/${created.id}/edit`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/catalog\/products\/\d+\/edit/i, { timeout: 20_000 });

    // Add the first presentation and persist it successfully
    // Factor 23 — distinct from other tests to avoid selector collisions
    await addPresentationInEditForm(page, '23');
    await savePresentations(page);

    // Try to add a second presentation with the SAME type (auto-selected) and SAME factor
    await addPresentationInEditForm(page, '23');

    // Attempt to save — the backend should reject it with 4xx
    const duplicateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/product-presentations')
    );
    await page.getByRole('button', { name: /guardar presentaciones|save presentations/i }).click();
    const duplicateResponse = await duplicateResponsePromise;

    expect(duplicateResponse.status()).toBeGreaterThanOrEqual(400);

    // TODO: once the backend returns a descriptive error message,
    // add a toast/notification assertion here.
  });
});
