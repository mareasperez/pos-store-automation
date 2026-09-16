import { expect, type Page } from '@playwright/test';

import { config } from '@config';
import { buildApiHeaders } from '../../utils/apiHeaders';
import { openShiftIfPrompted } from '../../utils/shift';

/** Opens the payment modal via Confirm Sale -> Pay Now. */
export async function openPaymentModal(page: Page): Promise<void> {
  await openShiftIfPrompted(page);
  await page.locator('[data-testid="pos-confirm-sale"]:visible').click();
  await page.getByTestId('pos-pay-now').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 });
}

export async function selectBaseCurrency(page: Page): Promise<string> {
  const currencyButtons = page.getByTestId(/^pm-currency-/);
  const baseCurrency = (await currencyButtons.first().textContent())?.trim();
  expect(baseCurrency).toBeTruthy();
  await currencyButtons.first().click();
  return baseCurrency!;
}

export async function getSecondaryCurrency(page: Page): Promise<string> {
  const currencyButtons = page.getByTestId(/^pm-currency-/);
  const secondaryCurrency = (await currencyButtons.nth(1).textContent())?.trim();
  expect(secondaryCurrency).toBeTruthy();
  return secondaryCurrency!;
}

export async function findActiveUsdCashMethod(page: Page): Promise<string | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  if (!response.ok()) return null;

  const methods = (await response.json()) as Array<{
    code: string;
    type: string;
    active: boolean;
    currency: string;
  }>;
  return methods.find((method) =>
    method.type === 'CASH' && method.active && method.currency === 'USD'
  )?.code ?? null;
}

export async function getUsdExchangeRate(page: Page): Promise<number | null> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/tenants/${config.tenantId}`, { headers });
  if (!response.ok()) return null;

  const tenant = (await response.json()) as {
    exchangeRates?: Record<string, { rate?: number }>;
  };
  return tenant.exchangeRates?.USD?.rate ?? null;
}
