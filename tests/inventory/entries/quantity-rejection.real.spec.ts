import { randomUUID } from 'node:crypto';
import { expect, expectHttpError, serialDescribe, test } from '@fixtures';

interface Presentation {
  id: number;
  presentationTypeId: number;
  conversionFactor: number;
  price: number;
  cost: number;
  taxRate: number;
  barcode: string;
  active: boolean;
  isBasePresentation: boolean;
  priceMode: string;
  allowsFractionalQuantity: boolean;
}

serialDescribe('@regression @inventory', () => {
  test('real quantity rejection marks only the submitted duplicate row', async ({ page }) => {
    // Keep configuration imports inside the test so --list does not load environment files.
    const { config } = await import('@config');
    const { buildApiHeaders } = await import('../../../utils/apiHeaders');
    expect(config.environment).toBe('local');
    expect(config.baseUrl).toBe('http://localhost:5173');
    expect(config.apiRoot).toBe('http://localhost:8081/api');
    expect(config.tenantId, 'Set an explicit local test tenant').toBeTruthy();

    await page.context().route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' &&
        url.hostname === 'localhost' &&
        ['5173', '8081'].includes(url.port)
        ? route.continue()
        : route.abort('blockedbyclient');
    });

    const state = await page.context().storageState();
    const store = state.origins
      .find((origin) => origin.origin === config.baseUrl)
      ?.localStorage.find((entry) => entry.name === 'pos_app_store');
    expect(store, 'Saved local tenant is required').toBeTruthy();
    const saved = JSON.parse(store!.value) as { state: { activeTenantId: string } };
    expect(saved.state.activeTenantId, 'Saved session must match the test tenant').toBe(
      config.tenantId
    );
    const runtime = await page.request.get(`${config.baseUrl}/config/app-config.json`, {
      maxRedirects: 0,
    });
    expect(runtime.ok()).toBe(true);
    const runtimeConfig = (await runtime.json()) as { apiUrl: string };
    const runtimeApi = new URL(runtimeConfig.apiUrl);
    expect(runtimeApi.origin).toBe('http://localhost:8081');

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
    const warehouse = warehouses.find((candidate) => candidate.active);
    expect(warehouse, 'Active warehouse required').toBeTruthy();
    const types = await api<{ content: { id: number; code: string }[] }>('/presentation-types');
    const unitId = types.content.find((type) => type.code === 'UNIT')?.id;
    expect(unitId, 'UNIT presentation type required').toBeTruthy();

    const prefix = `QRE-${randomUUID().slice(0, 8)}`;
    const barcode = `${prefix}-PACK`;
    const product = await api<{ id: number }>('/products', 'POST', {
      name: prefix,
      sku: prefix,
      active: true,
      type: 'STANDARD',
      stock: 0,
      basePresentation: {
        presentationTypeId: unitId,
        conversionFactor: 1,
        price: 10,
        cost: 2,
        taxRate: 0,
        active: true,
        isBasePresentation: true,
        priceMode: 'PRICE_DRIVEN',
      },
    });
    const presentation = await api<Presentation>(
      `/product-presentations?productId=${product.id}`,
      'POST',
      {
        productId: product.id,
        presentationTypeId: unitId,
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
      `Quantity rejection fixture: product ${product.id}, presentation ${presentation.id}`
    );

    await page.goto('/inventory/entries/new');
    await expect(page.getByLabel('Almacén')).toBeVisible();
    await expect(
      page.getByLabel('Almacén').locator(`option[value="${warehouse!.id}"]`)
    ).toHaveCount(1);
    await page.getByLabel('Almacén').selectOption(String(warehouse!.id));
    const search = page.getByPlaceholder('Buscar item (nombre, codigo o presentacion)...');
    for (const quantity of ['1', '0.5']) {
      await search.fill(barcode);
      await page.locator('.typeahead__item').filter({ hasText: barcode }).click();
      await page.getByLabel(/^Cantidad/).fill(quantity);
      await page.getByRole('button', { name: 'Agregar linea' }).click();
    }

    const rows = page.locator('tbody tr').filter({ hasText: prefix });
    await expect(rows).toHaveCount(2);
    const firstQuantity = rows.nth(0).getByRole('textbox', { name: `${prefix} Cantidad` });
    const secondQuantity = rows.nth(1).getByRole('textbox', { name: `${prefix} Cantidad` });
    await expect(firstQuantity).toHaveValue('1');
    await expect(secondQuantity).toHaveValue('0.5');

    // Both rows retain their loaded policy; only the test-owned server presentation changes.
    const changed = await api<Presentation>(`/product-presentations/${presentation.id}`, 'PUT', {
      ...presentation,
      allowsFractionalQuantity: false,
    });
    expect(changed.allowsFractionalQuantity).toBe(false);
    expectHttpError(400, '/inventory/entries');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/inventory/entries'
    );
    await page.getByRole('button', { name: 'Guardar y Publicar' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(400);
    const submitted = response.request().postDataJSON() as {
      lines: { productId: number; presentationId: number; quantity: number }[];
    };
    expect(submitted.lines).toEqual([
      expect.objectContaining({
        productId: product.id,
        presentationId: presentation.id,
        quantity: 1,
      }),
      expect.objectContaining({
        productId: product.id,
        presentationId: presentation.id,
        quantity: 0.5,
      }),
    ]);
    expect(await response.json()).toMatchObject({
      code: 'DOMAIN_ERROR',
      lineIndex: 1,
      quantityReason: 'FRACTIONAL_QUANTITY_NOT_ALLOWED',
    });

    const errorText = 'Esta presentación ya no admite fracciones. Ingresá una cantidad entera.';
    await expect(firstQuantity).toHaveAttribute('aria-invalid', 'false');
    await expect(secondQuantity).toHaveAttribute('aria-invalid', 'true');
    await expect(rows.nth(0).getByText(errorText)).toHaveCount(0);
    const message = rows.nth(1).getByText(errorText, { exact: true });
    await expect(message).toBeVisible();
    await expect(message).toHaveAttribute('id', /.+/);
    const messageId = await message.getAttribute('id');
    await expect(secondQuantity).toHaveAttribute('aria-describedby', messageId!);
    await expect(firstQuantity).toHaveValue('1');
    await expect(secondQuantity).toHaveValue('0.5');

    await secondQuantity.fill('1');
    await expect(secondQuantity).toHaveAttribute('aria-invalid', 'false');
    await expect(message).toHaveCount(0);
  });
});
