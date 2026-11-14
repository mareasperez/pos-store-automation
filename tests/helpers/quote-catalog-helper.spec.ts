import { expect, test } from '@playwright/test';
import { waitForQuoteCatalogReady } from '../../support/flows/quotes.flow';

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(15_000);

const catalogPage = `
  <input data-testid="quote-form-customer">
  <p role="status" data-testid="quote-form-catalog-loading">Loading catalog</p>
  <div role="alert" data-testid="quote-form-catalog-error" hidden>Catalog unavailable</div>
  <script>
    const loading = document.querySelector('[data-testid="quote-form-catalog-loading"]');
    const error = document.querySelector('[data-testid="quote-form-catalog-error"]');
    fetch('https://api.example.invalid/api/products')
      .then((response) => {
        if (!response.ok) throw new Error('Catalog request failed');
        return response.json();
      })
      .then(() => loading.remove())
      .catch(() => {
        loading.remove();
        error.hidden = false;
      });
  </script>
`;

test('waits for delayed catalog readiness before allowing quote quantity assertions', async ({
  page,
}) => {
  let releaseCatalog!: () => void;
  let catalogRequestStarted!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const catalogStarted = new Promise<void>((resolve) => {
    catalogRequestStarted = resolve;
  });

  await page.route('https://api.example.invalid/api/products', async (route) => {
    catalogRequestStarted();
    await catalogGate;
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: [],
    });
  });
  await page.setContent(catalogPage);
  await catalogStarted;

  const loading = page.getByTestId('quote-form-catalog-loading');
  await expect(loading).toBeVisible();
  let catalogReady = false;
  const waitingForCatalog = waitForQuoteCatalogReady(page).then(() => {
    catalogReady = true;
  });
  await expect(loading).toBeVisible();
  expect(catalogReady).toBe(false);
  releaseCatalog();
  await waitingForCatalog;

  await expect(loading).toBeHidden();
  await expect(page.getByTestId('quote-form-catalog-error')).toBeHidden();
});

test('fails explicitly when the quote catalog reports an error', async ({ page }) => {
  await page.route('https://api.example.invalid/api/products', async (route) => {
    await route.fulfill({
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'Catalog unavailable',
    });
  });
  await page.setContent(catalogPage);
  await expect(page.getByTestId('quote-form-catalog-error')).toBeVisible();

  await expect(waitForQuoteCatalogReady(page)).rejects.toThrow(
    'Quote catalog failed to load; retry before continuing.'
  );
});
