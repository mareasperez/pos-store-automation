import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import {
  buildApiHeaders,
  getPresentationConversionFactor,
} from './sales.flow';

export interface ReturnSaleLine {
  id: number;
  productId: number;
  presentationId: number;
  quantity: number;
}

export interface ReturnSaleDetail {
  id: number;
  customerId: number;
  total: number;
  status: string;
  paymentTerm: string;
  lines: ReturnSaleLine[];
}

export interface ReturnDTO {
  id: number;
  saleId: number;
  status: string;
  totalRefunded: number;
  refundMethod: string;
  financialMovementId: number | null;
  itemCount: number;
  refundPaymentMethodId: number | null;
}

interface PaymentMethod {
  id: number;
  type: string;
  active: boolean;
}

interface PaymentReconciliation {
  paymentMethodId: number;
  expectedAmount: number;
}

export interface ActiveShift {
  paymentReconciliations: PaymentReconciliation[];
}

export async function getReturnSaleDetail(
  page: Page,
  saleId: number
): Promise<ReturnSaleDetail> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/sales/${saleId}`, { headers });
  expect(response.ok(), `GET /sales/${saleId} failed: ${response.status()}`).toBeTruthy();
  return (await response.json()) as ReturnSaleDetail;
}

export async function getFirstWarehouseId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/inventory/warehouses`, { headers });
  if (!response.ok()) return null;
  const warehouses = (await response.json()) as Array<{ id: number }>;
  return warehouses[0]?.id ?? null;
}

export async function getFirstActiveCashPaymentMethodId(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  if (!response.ok()) return null;
  const methods = (await response.json()) as PaymentMethod[];
  return methods.find((method) => method.type === 'CASH' && method.active)?.id ?? null;
}

export async function getActiveShiftWithExpectations(page: Page): Promise<ActiveShift | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(
    `${config.apiRoot}/shifts/active?includeExpectations=true`,
    { headers: { ...headers, 'Cache-Control': 'no-cache' } }
  );
  return response.status() === 200 ? ((await response.json()) as ActiveShift) : null;
}

export function getExpectedAmount(shift: ActiveShift, paymentMethodId: number): number {
  return (
    shift.paymentReconciliations.find(
      (reconciliation) => reconciliation.paymentMethodId === paymentMethodId
    )?.expectedAmount ?? 0
  );
}

export async function getExpectedBaseUnitReturns(
  page: Page,
  lines: ReturnSaleLine[]
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  for (const line of lines) {
    const conversionFactor = await getPresentationConversionFactor(
      page,
      line.productId,
      line.presentationId
    );
    const baseUnits = line.quantity * conversionFactor;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + baseUnits);
  }
  return totals;
}