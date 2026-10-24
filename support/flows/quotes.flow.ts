import { expect, type Page } from '@playwright/test';

import { config } from '@config';
import { buildApiHeaders } from '../../utils/apiHeaders';

export interface StockedProduct {
  skuId: number;
  name: string;
  /** Base presentation; selects the exact product card (`product-card-{skuId}-{presentationId}`). */
  presentationId: number;
  warehouseId: number;
  warehouseName: string;
  onHandQty: number;
}

export interface QuoteLineSummary {
  id: number;
  sellableType: 'PRODUCT' | 'SERVICE' | 'GENERIC_CHARGE';
  productId: number | null;
  presentationId: number | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
}

export interface QuoteSummary {
  id: number;
  quoteNumber: string;
  customerId: number;
  warehouseId: number;
  status: 'OPEN' | 'SOLD' | 'CANCELLED';
  expired: boolean;
  /** Prices include tax: subtotal (net) + tax = total. */
  subtotal: number;
  tax: number;
  total: number;
  saleId: number | null;
  createdByName: string | null;
  lines: QuoteLineSummary[];
}

/**
 * A sellable STANDARD product with stock in one specific warehouse. Quotes are tied to a
 * warehouse and the sale deducts from it, so the warehouse must hold the stock, not the tenant.
 */
export async function findStockedProductInWarehouse(page: Page): Promise<StockedProduct | null> {
  const headers = await buildApiHeaders(page);
  const [stockResponse, warehousesResponse] = await Promise.all([
    page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, { headers }),
    page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers }),
  ]);
  if (!stockResponse.ok() || !warehousesResponse.ok()) return null;

  const warehouses = (await warehousesResponse.json()) as Array<{
    id: number;
    name: string;
    active?: boolean;
  }>;
  const activeWarehouses = new Map(
    warehouses.filter((warehouse) => warehouse.active !== false).map((w) => [w.id, w.name])
  );
  const rows = (
    (await stockResponse.json()) as Array<{ skuId: number; warehouseId: number; onHandQty: number }>
  )
    .filter((row) => row.onHandQty >= 5 && activeWarehouses.has(row.warehouseId))
    .sort((left, right) => right.onHandQty - left.onHandQty);

  for (const row of rows.slice(0, 10)) {
    const productResponse = await page.request.get(`${config.apiRoot}/products/${row.skuId}`, {
      headers,
    });
    if (!productResponse.ok()) continue;
    const product = (await productResponse.json()) as {
      active?: boolean;
      name?: string;
      sellableType?: string;
      type?: string;
    };
    if (product.active === false || !product.name) continue;
    if (product.sellableType && product.sellableType !== 'PRODUCT') continue;
    if (product.type && product.type !== 'STANDARD') continue;
    return {
      skuId: row.skuId,
      name: product.name,
      presentationId: await getBasePresentationId(page, row.skuId),
      warehouseId: row.warehouseId,
      warehouseName: activeWarehouses.get(row.warehouseId)!,
      onHandQty: row.onHandQty,
    };
  }
  return null;
}

export async function findActiveCustomer(page: Page): Promise<{ id: number; name: string } | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/customers`, { headers });
  if (!response.ok()) return null;
  const customers = (await response.json()) as Array<{
    id: number;
    name?: string;
    status?: string;
  }>;
  const customer = customers.find((c) => c.status !== 'INACTIVE' && c.name && c.name.length >= 3);
  return customer ? { id: customer.id, name: customer.name! } : null;
}

/** The active warehouse holding stock of a product (e.g. the initial stock of a new product). */
export async function findStockWarehouse(
  page: Page,
  skuId: number
): Promise<{ warehouseId: number; warehouseName: string } | null> {
  const headers = await buildApiHeaders(page);
  const [stockResponse, warehousesResponse] = await Promise.all([
    page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, { headers }),
    page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers }),
  ]);
  if (!stockResponse.ok() || !warehousesResponse.ok()) return null;
  const warehouses = (await warehousesResponse.json()) as Array<{
    id: number;
    name: string;
    active?: boolean;
  }>;
  const rows = (await stockResponse.json()) as Array<{
    skuId: number;
    warehouseId: number;
    onHandQty: number;
  }>;
  for (const row of rows.filter((r) => r.skuId === skuId && r.onHandQty > 0)) {
    const warehouse = warehouses.find((w) => w.id === row.warehouseId && w.active !== false);
    if (warehouse) return { warehouseId: warehouse.id, warehouseName: warehouse.name };
  }
  return null;
}

/** On-hand stock of one product in one warehouse, in base units. */
export async function getWarehouseStock(
  page: Page,
  skuId: number,
  warehouseId: number
): Promise<number> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/inventory/stock-balance/all`, {
    headers,
  });
  expect(response.ok(), `GET /inventory/stock-balance/all failed: ${response.status()}`).toBe(true);
  const rows = (await response.json()) as Array<{
    skuId: number;
    warehouseId: number;
    onHandQty: number;
  }>;
  return rows
    .filter((row) => row.skuId === skuId && row.warehouseId === warehouseId)
    .reduce((total, row) => total + row.onHandQty, 0);
}

export async function getQuote(page: Page, id: number): Promise<QuoteSummary> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/quotes/${id}`, { headers });
  expect(response.ok(), `GET /quotes/${id} failed: ${response.status()}`).toBe(true);
  return (await response.json()) as QuoteSummary;
}

/** Base presentation of a product, used to create quotes directly through the API. */
async function getBasePresentationId(page: Page, productId: number): Promise<number> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/product-presentations`, {
    headers,
    params: { productId },
  });
  expect(response.ok(), `GET /product-presentations failed: ${response.status()}`).toBe(true);
  const presentations = (await response.json()) as Array<{
    id: number;
    isBasePresentation?: boolean;
    active?: boolean;
  }>;
  const base =
    presentations.find((p) => p.isBasePresentation && p.active !== false) ??
    presentations.find((p) => p.active !== false);
  expect(base, `Product ${productId} has no active presentation`).toBeTruthy();
  return base!.id;
}

export async function createQuoteViaApi(
  page: Page,
  input: { customerId: number; warehouseId: number; productId: number; quantity: number }
): Promise<QuoteSummary> {
  const headers = await buildApiHeaders(page);
  const presentationId = await getBasePresentationId(page, input.productId);
  const response = await page.request.post(`${config.apiRoot}/quotes`, {
    headers,
    data: {
      customerId: input.customerId,
      warehouseId: input.warehouseId,
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      notes: 'E2E quote',
      lines: [
        {
          sellableType: 'PRODUCT',
          productId: input.productId,
          presentationId,
          quantity: input.quantity,
        },
      ],
    },
  });
  expect(response.status(), `POST /quotes failed: ${await response.text()}`).toBe(201);
  return (await response.json()) as QuoteSummary;
}

export async function cancelQuoteViaApi(page: Page, id: number): Promise<QuoteSummary> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.post(`${config.apiRoot}/quotes/${id}/cancel`, { headers });
  expect(response.ok(), `POST /quotes/${id}/cancel failed: ${response.status()}`).toBe(true);
  return (await response.json()) as QuoteSummary;
}
