import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { buildApiHeaders } from '../../../utils/apiHeaders';

test('@local @inventory fractional entry is submitted and posted without rounding or double conversion', async ({
  page,
}) => {
  expect(config.environment).toBe('local');
  expect(config.baseUrl).toBe('http://localhost:5173');
  expect(config.apiRoot).toBe('http://localhost:8081/api');
  expect(config.tenantId, 'Explicit local test tenant required').toBeTruthy();
  let forbiddenAuthAttempt = false;
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (/\/(?:api\/)?auth\/(?:login|refresh)(?:\/|$)/.test(url.pathname)) {
      forbiddenAuthAttempt = true;
      return route.abort('blockedbyclient');
    }
    const localUi = url.origin === 'http://localhost:5173';
    const localApi =
      ['http://localhost:8081', 'http://127.0.0.1:8081'].includes(url.origin) &&
      (url.pathname === '/api' || url.pathname.startsWith('/api/'));
    return localUi || localApi ? route.continue() : route.abort('blockedbyclient');
  });
  const state = await page.context().storageState();
  const stored = state.origins
    .find((origin) => origin.origin === config.baseUrl)
    ?.localStorage.find((entry) => entry.name === 'pos_app_store');
  expect(stored, 'Numbered saved local session required').toBeTruthy();
  const saved = JSON.parse(stored!.value) as { state: { activeTenantId: string } };
  expect(saved.state.activeTenantId).toBe(config.tenantId);
  const runtime = await page.request.get(`${config.baseUrl}/config/app-config.json`, {
    maxRedirects: 0,
  });
  expect(runtime.ok()).toBe(true);
  const { apiUrl } = (await runtime.json()) as { apiUrl: string };
  const runtimeApi = new URL(apiUrl);
  expect(['http://localhost:8081', 'http://127.0.0.1:8081']).toContain(runtimeApi.origin);
  expect(['/', '/api', '/api/']).toContain(runtimeApi.pathname);
  const headers = await buildApiHeaders(page);
  async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await page.request.fetch(`${config.apiRoot}${path}`, {
      method,
      headers,
      maxRedirects: 0,
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  }
  const warehouses = await api<{ id: number; active: boolean }[]>('/inventory/warehouses');
  const warehouse = warehouses.find((item) => item.active);
  expect(warehouse, 'Active warehouse required').toBeTruthy();
  const types = await api<{ content: { id: number; isDivisible: boolean }[] }>(
    '/presentation-types'
  );
  const type = types.content.find((item) => item.isDivisible);
  expect(type, 'Existing divisible base unit required').toBeTruthy();
  const name = `FQE-${randomUUID().slice(0, 8)}`;
  const barcode = `${name}-2`;
  const product = await api<{ id: number }>('/products', 'POST', {
    name,
    sku: name,
    active: true,
    type: 'STANDARD',
    stock: 0,
    basePresentation: {
      presentationTypeId: type!.id,
      conversionFactor: 1,
      price: 10,
      cost: 2,
      taxRate: 0,
      active: true,
      isBasePresentation: true,
      priceMode: 'PRICE_DRIVEN',
    },
  });
  const presentation = await api<{ id: number; allowsFractionalQuantity: boolean }>(
    `/product-presentations?productId=${product.id}`,
    'POST',
    {
      productId: product.id,
      presentationTypeId: type!.id,
      conversionFactor: 2,
      price: 20,
      cost: 4,
      taxRate: 0,
      barcode,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: true,
    }
  );
  expect(presentation.allowsFractionalQuantity).toBe(true);
  console.log(
    `Fractional UI entry fixture ${name}: product ${product.id}, presentation ${presentation.id}`
  );

  await page.goto('/inventory/entries/new');
  await expect(page.getByLabel('Almacén')).toBeVisible({ timeout: 45_000 });
  await page.getByLabel('Almacén').selectOption(String(warehouse!.id));
  const search = page.getByPlaceholder('Buscar item (nombre, codigo o presentacion)...');
  await search.fill(barcode.toUpperCase());
  await page.locator('.typeahead__item').filter({ hasText: barcode }).click();
  await page.getByLabel(/^Cantidad/).fill('0.9725');
  await page.getByRole('button', { name: 'Agregar linea' }).click();
  const row = page.locator('tbody tr').filter({ hasText: name });
  await expect(row.getByRole('textbox', { name: `${name} Cantidad` })).toHaveValue('0.9725');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/inventory/entries'
  );
  await page.getByRole('button', { name: 'Guardar y Publicar' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({
    warehouseId: warehouse!.id,
    lines: [{ productId: product.id, presentationId: presentation.id, quantity: 0.9725 }],
  });
  const entry = (await response.json()) as {
    id: number;
    status: string;
    lines: { productId: number; presentationId: number; quantity: number }[];
  };
  console.log(`Fractional UI inventory entry ${entry.id}`);
  expect(entry.status).toBe('POSTED');
  expect(entry.lines).toEqual([
    expect.objectContaining({
      productId: product.id,
      presentationId: presentation.id,
      quantity: 0.9725,
    }),
  ]);
  expect(
    await api<{
      status: string;
      lines: { productId: number; presentationId: number; quantity: number }[];
    }>(`/inventory/entries/${entry.id}`)
  ).toMatchObject({
    status: 'POSTED',
    lines: [{ productId: product.id, presentationId: presentation.id, quantity: 0.9725 }],
  });
  const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
    '/inventory/stock-balance/all'
  );
  expect(
    Number(
      balances.find((item) => item.skuId === product.id && item.warehouseId === warehouse!.id)
        ?.onHandQty
    )
  ).toBe(1.945);
  expect(forbiddenAuthAttempt, 'Login or refresh is not authorized').toBe(false);
});
