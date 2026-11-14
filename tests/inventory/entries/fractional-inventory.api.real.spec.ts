import { randomUUID } from 'node:crypto';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { buildApiHeaders } from '../../../utils/apiHeaders';

type Presentation = {
  id: number;
  conversionFactor: number;
  allowsFractionalQuantity: boolean;
};
type InventoryDocument = {
  id: number;
  status: string;
  lines: { productId: number; presentationId: number; quantity: number }[];
};

test('@local @inventory @api-contract fractional entry and departure preserve exact base stock and reject sealed fractions', async ({
  page,
}) => {
  expect(config.environment).toBe('local');
  expect(config.baseUrl).toBe('http://localhost:5173');
  expect(config.apiRoot).toBe('http://localhost:8081/api');
  expect(config.tenantId, 'Explicit local test tenant required').toBeTruthy();
  await page.context().route('**/*', (route) => route.abort('blockedbyclient'));
  const state = await page.context().storageState();
  const stored = state.origins
    .find((origin) => origin.origin === config.baseUrl)
    ?.localStorage.find((entry) => entry.name === 'pos_app_store');
  expect(stored, 'Numbered saved local session required').toBeTruthy();
  const saved = JSON.parse(stored!.value) as { state: { activeTenantId: string } };
  expect(saved.state.activeTenantId, 'Numbered saved session must match the tenant').toBe(
    config.tenantId
  );
  const headers = await buildApiHeaders(page);
  async function request(path: string, method = 'GET', data?: unknown) {
    return page.request.fetch(`${config.apiRoot}${path}`, {
      method,
      headers,
      maxRedirects: 0,
      ...(data === undefined ? {} : { data }),
    });
  }
  async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const response = await request(path, method, data);
    expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
    return (await response.json()) as T;
  }

  const types = await api<{ content: { id: number; isDivisible: boolean }[] }>(
    '/presentation-types'
  );
  const divisible = types.content.find((type) => type.isDivisible);
  expect(divisible, 'Existing divisible base unit required; no policy is changed').toBeTruthy();
  const warehouses = await api<{ id: number; active: boolean }[]>('/inventory/warehouses');
  const warehouse = warehouses.find((item) => item.active);
  expect(warehouse, 'Active warehouse required').toBeTruthy();
  const name = `FQI-${randomUUID().slice(0, 8)}`;
  const product = await api<{ id: number }>('/products', 'POST', {
    name,
    sku: name,
    active: true,
    type: 'STANDARD',
    stock: 0,
    basePresentation: {
      presentationTypeId: divisible!.id,
      conversionFactor: 1,
      price: 10,
      cost: 2,
      taxRate: 0,
      active: true,
      isBasePresentation: true,
      priceMode: 'PRICE_DRIVEN',
    },
  });
  console.log(`Fractional inventory fixture ${name}: product ${product.id}`);
  async function presentation(factor: number, fractional?: boolean): Promise<Presentation> {
    return api<Presentation>(`/product-presentations?productId=${product.id}`, 'POST', {
      productId: product.id,
      presentationTypeId: divisible!.id,
      conversionFactor: factor,
      price: 10,
      cost: 2,
      taxRate: 0,
      barcode: `${name}-${factor}`,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
      ...(fractional === undefined ? {} : { allowsFractionalQuantity: fractional }),
    });
  }
  const loose = await presentation(2, true);
  const sealed = await presentation(3);
  const half = await presentation(0.5);
  console.log(`Presentations: loose ${loose.id}, sealed ${sealed.id}, fixed half ${half.id}`);
  expect(loose.allowsFractionalQuantity).toBe(true);
  expect(sealed.allowsFractionalQuantity).toBe(false);
  expect(half.allowsFractionalQuantity).toBe(false);
  const invalidFractionalFactor = await request(
    `/product-presentations?productId=${product.id}`,
    'POST',
    {
      productId: product.id,
      presentationTypeId: divisible!.id,
      conversionFactor: 0.5,
      price: 10,
      cost: 2,
      taxRate: 0,
      barcode: `${name}-invalid`,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: true,
    }
  );
  expect(invalidFractionalFactor.status()).toBe(400);

  async function stock(): Promise<number> {
    const balances = await api<{ skuId: number; warehouseId: number; onHandQty: number }[]>(
      '/inventory/stock-balance/all'
    );
    return Number(
      balances.find((item) => item.skuId === product.id && item.warehouseId === warehouse!.id)
        ?.onHandQty ?? 0
    );
  }
  const issuedAt = new Date().toISOString();
  async function entry(presentationId: number, quantity: number) {
    return request('/inventory/entries', 'POST', {
      warehouseId: warehouse!.id,
      reason: 'ADJUSTMENT',
      issuedAt,
      referenceDoc: name,
      lines: [{ productId: product.id, presentationId, quantity, presentationCost: 2 }],
    });
  }
  expect(await stock()).toBe(0);
  const excessivePrecision = await entry(loose.id, 0.00001);
  expect(excessivePrecision.status()).toBe(400);
  expect(await stock()).toBe(0);
  const inbound = await entry(loose.id, 0.9725);
  expect(inbound.status()).toBe(201);
  const added = (await inbound.json()) as InventoryDocument;
  console.log(`Fractional inventory entry ${added.id}`);
  expect(added.status).toBe('POSTED');
  expect(added.lines).toEqual([
    expect.objectContaining({ productId: product.id, presentationId: loose.id, quantity: 0.9725 }),
  ]);
  expect(await api<InventoryDocument>(`/inventory/entries/${added.id}`)).toMatchObject({
    status: 'POSTED',
    lines: [{ productId: product.id, presentationId: loose.id, quantity: 0.9725 }],
  });
  expect(await stock()).toBe(1.945);

  const rejected = await entry(sealed.id, 0.5);
  expect(rejected.status()).toBe(400);
  expect(await stock()).toBe(1.945);
  const fixedHalf = await entry(half.id, 1);
  expect(fixedHalf.status()).toBe(201);
  const halfDocument = (await fixedHalf.json()) as InventoryDocument;
  console.log(`Fixed-half inventory entry ${halfDocument.id}`);
  expect(halfDocument.lines[0]).toMatchObject({ presentationId: half.id, quantity: 1 });
  expect(await stock()).toBe(2.445);

  const departure = await request('/inventory/departures', 'POST', {
    warehouseId: warehouse!.id,
    reason: 'ADJUSTMENT_NEGATIVE',
    destinationType: 'ADJUSTMENT',
    issuedAt,
    notes: name,
    lines: [{ productId: product.id, presentationId: loose.id, quantity: 0.4725 }],
  });
  expect(departure.status()).toBe(201);
  const removed = (await departure.json()) as InventoryDocument;
  console.log(`Fractional inventory departure ${removed.id}`);
  expect(removed.status).toBe('POSTED');
  expect(removed.lines[0]).toMatchObject({
    productId: product.id,
    presentationId: loose.id,
    quantity: 0.4725,
  });
  expect(await api<InventoryDocument>(`/inventory/departures/${removed.id}`)).toMatchObject({
    status: 'POSTED',
    lines: [{ productId: product.id, presentationId: loose.id, quantity: 0.4725 }],
  });
  expect(await stock()).toBe(1.5);
});
