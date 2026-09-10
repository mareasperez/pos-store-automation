/**
 * Regression e2e proving CashReceiptService preserves the request's declared currency instead of
 * silently discarding it: `CreateCashReceiptRequest` now carries `currencyCode`/`exchangeRate`,
 * `CashReceiptService` validates every payment-method currency against the declared currency, and
 * persists `baseTotalAmount` for reconciliation.
 *
 * Fixed: docs/KNOWN_GAPS.md gap #10 (Cash Receipt Currency Contract Is Not Wired Through).
 *
 * Uses a non-cash-drawer USD payment method (requiresShiftCount=false) on purpose, so this test
 * doesn't depend on an open shift and can run in the default parallel suite.
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

test.setTimeout(60_000);

async function buildApiHeaders(page: Page): Promise<Record<string, string>> {
  const storageState = await page.context().storageState();
  const token = storageState.cookies.find((c) => c.name === 'access_token')?.value;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.Cookie = `access_token=${token}`;
  }
  if (config.tenantId) headers['X-Tenant-Id'] = config.tenantId;
  return headers;
}

type PaymentMethod = {
  id: number;
  code: string;
  type: string;
  active: boolean;
  currency: string;
  requiresShiftCount: boolean;
};

async function getPaymentMethods(page: Page, headers: Record<string, string>) {
  const methodsRes = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
  expect(methodsRes.ok(), `GET /payment-methods failed: ${methodsRes.status()}`).toBeTruthy();
  return (await methodsRes.json()) as PaymentMethod[];
}

/** The tenant's actual base currency (authoritative — not inferred), same field the frontend reads. */
async function getTenantBaseCurrency(page: Page, headers: Record<string, string>): Promise<string> {
  const settingsRes = await page.request.get(
    `${config.apiRoot}/tenants/${config.tenantId}/settings`,
    { headers }
  );
  expect(
    settingsRes.ok(),
    `GET /tenants/${config.tenantId}/settings failed: ${settingsRes.status()}`
  ).toBeTruthy();
  const settings = (await settingsRes.json()) as { currency: string };
  return settings.currency;
}

async function getTenantExchangeRates(page: Page, headers: Record<string, string>) {
  const tenantRes = await page.request.get(`${config.apiRoot}/tenants/${config.tenantId}`, {
    headers,
  });
  expect(
    tenantRes.ok(),
    `GET /tenants/${config.tenantId} failed: ${tenantRes.status()}`
  ).toBeTruthy();
  return (await tenantRes.json()) as {
    exchangeRates?: Record<string, { rate: number }>;
  };
}

test.describe('@regression @pos @cash-receipts @currency @session-mc-20260909', () => {
  test('@regression creating a cash receipt fully in USD must preserve USD, not the tenant base currency', async ({
    page,
  }) => {
    requireCredentialsOrSkip('cash receipt currency mismatch');

    const headers = await buildApiHeaders(page);
    const methods = await getPaymentMethods(page, headers);

    const usdMethod = methods.find(
      (m) => m.active && m.currency === 'USD' && !m.requiresShiftCount
    );
    test.skip(
      !usdMethod,
      'No active non-cash-drawer USD payment method in the test tenant ' +
        '(need requiresShiftCount=false, e.g. a USD transfer/card method).'
    );

    const tenant = await getTenantExchangeRates(page, headers);
    const usdRate = tenant.exchangeRates?.USD?.rate;
    test.skip(!usdRate, 'No active USD exchange rate configured for the test tenant.');

    const createRes = await page.request.post(`${config.apiRoot}/cash-receipts`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        type: 'OTHER_INCOME',
        amount: 100,
        currencyCode: 'USD',
        exchangeRate: usdRate,
        paymentMethods: [{ paymentMethodId: usdMethod!.id, amount: 100 }],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const receipt = (await createRes.json()) as {
      id: number;
      currencyCode: string;
      totalAmount: number;
      baseTotalAmount: number | null;
    };

    console.log(
      `[cash-receipt-currency] created receipt #${receipt.id} ` +
        `currencyCode=${receipt.currencyCode} totalAmount=${receipt.totalAmount} ` +
        `baseTotalAmount=${receipt.baseTotalAmount}`
    );

    // The receipt was declared and paid entirely in USD — the backend must preserve that,
    // not silently coerce it to the tenant's base currency.
    expect(
      receipt.currencyCode,
      `Cash receipt #${receipt.id} was created with amount=100 in USD but the server stored ` +
        `currencyCode="${receipt.currencyCode}".`
    ).toBe('USD');

    // The base-currency equivalent must be persisted for reconciliation (shift/void flows).
    expect(
      receipt.baseTotalAmount,
      'baseTotalAmount must be persisted for a foreign-currency receipt'
    ).not.toBeNull();
  });

  test('@regression creating a base-currency cash receipt must not persist an exchange rate', async ({
    page,
  }) => {
    requireCredentialsOrSkip('cash receipt currency mismatch');

    const headers = await buildApiHeaders(page);
    const methods = await getPaymentMethods(page, headers);
    const baseCurrency = await getTenantBaseCurrency(page, headers);

    const baseMethod = methods.find(
      (m) => m.active && m.currency === baseCurrency && !m.requiresShiftCount
    );
    test.skip(
      !baseMethod,
      `No active non-cash-drawer ${baseCurrency} payment method in the test tenant.`
    );

    const createRes = await page.request.post(`${config.apiRoot}/cash-receipts`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        type: 'OTHER_INCOME',
        amount: 50,
        currencyCode: baseCurrency,
        paymentMethods: [{ paymentMethodId: baseMethod!.id, amount: 50 }],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const receipt = (await createRes.json()) as {
      currencyCode: string;
      exchangeRate: number | null;
      baseTotalAmount: number | null;
    };

    expect(receipt.currencyCode).toBe(baseCurrency);
    expect(receipt.exchangeRate, 'no exchangeRate expected for a base-currency receipt').toBeNull();
    expect(
      receipt.baseTotalAmount,
      'no baseTotalAmount expected for a base-currency receipt (no conversion needed)'
    ).toBeNull();
  });

  test('@regression foreign-currency cash receipt without exchangeRate must be rejected', async ({
    page,
  }) => {
    requireCredentialsOrSkip('cash receipt currency mismatch');

    const headers = await buildApiHeaders(page);
    const methods = await getPaymentMethods(page, headers);
    const usdMethod = methods.find(
      (m) => m.active && m.currency === 'USD' && !m.requiresShiftCount
    );
    test.skip(
      !usdMethod,
      'No active non-cash-drawer USD payment method in the test tenant.'
    );

    const createRes = await page.request.post(`${config.apiRoot}/cash-receipts`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        type: 'OTHER_INCOME',
        amount: 100,
        currencyCode: 'USD',
        paymentMethods: [{ paymentMethodId: usdMethod!.id, amount: 100 }],
      },
    });

    expect(createRes.status(), await createRes.text()).toBe(400);
    const body = await createRes.text();
    expect(body).toContain('exchangeRate is required');
  });

  test('@regression cash receipt with a payment method currency mismatch must be rejected', async ({
    page,
  }) => {
    requireCredentialsOrSkip('cash receipt currency mismatch');

    const headers = await buildApiHeaders(page);
    const baseCurrency = await getTenantBaseCurrency(page, headers);
    const methods = await getPaymentMethods(page, headers);
    const usdMethod = methods.find(
      (m) => m.active && m.currency === 'USD' && !m.requiresShiftCount
    );
    test.skip(
      !usdMethod,
      'No active non-cash-drawer USD payment method in the test tenant.'
    );

    // Declares the tenant base currency but pays with a USD payment method — must be rejected.
    const createRes = await page.request.post(`${config.apiRoot}/cash-receipts`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: {
        type: 'OTHER_INCOME',
        amount: 100,
        currencyCode: baseCurrency,
        paymentMethods: [{ paymentMethodId: usdMethod!.id, amount: 100 }],
      },
    });

    expect(createRes.status(), await createRes.text()).toBe(400);
    const body = await createRes.text();
    expect(body).toContain('uses currency');
  });
});
