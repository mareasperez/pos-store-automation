/**
 * Regression e2e proving CashReceiptService silently discards the request's intended currency:
 * `CashReceiptService.createPostedCashReceipt` always sets `cashReceipt.currencyCode` to the
 * TENANT'S BASE currency, even when every payment method line on the receipt is denominated in
 * a different currency (e.g. USD). `CreateCashReceiptRequest` doesn't even have a
 * currencyCode/exchangeRate field today — the frontend's currency picker (CashReceiptsPage)
 * sends `currencyCode`, but the backend ignores it.
 *
 * See docs/KNOWN_GAPS.md gap #10 (Cash Receipt Currency Contract Is Not Wired Through).
 *
 * This test intentionally FAILS until that gap is closed. Once the backend threads
 * currencyCode/exchangeRate through and preserves the declared currency, it should pass without
 * modification.
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

test.describe('@regression @pos @cash-receipts @currency @session-mc-20260909', () => {
  test('@regression creating a cash receipt fully in USD must preserve USD, not the tenant base currency', async ({
    page,
  }) => {
    requireCredentialsOrSkip('cash receipt currency mismatch');

    const headers = await buildApiHeaders(page);
    const methodsRes = await page.request.get(`${config.apiRoot}/payment-methods`, { headers });
    expect(methodsRes.ok(), `GET /payment-methods failed: ${methodsRes.status()}`).toBeTruthy();
    const methods = (await methodsRes.json()) as PaymentMethod[];

    const usdMethod = methods.find(
      (m) => m.active && m.currency === 'USD' && !m.requiresShiftCount
    );
    test.skip(
      !usdMethod,
      'No active non-cash-drawer USD payment method in the test tenant ' +
        '(need requiresShiftCount=false, e.g. a USD transfer/card method).'
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
    expect(createRes.status(), await createRes.text()).toBe(200);
    const receipt = (await createRes.json()) as {
      id: number;
      currencyCode: string;
      totalAmount: number;
    };

    console.log(
      `[cash-receipt-currency] created receipt #${receipt.id} ` +
        `currencyCode=${receipt.currencyCode} totalAmount=${receipt.totalAmount}`
    );

    // The receipt was declared and paid entirely in USD — the backend must preserve that,
    // not silently coerce it to the tenant's base currency.
    expect(
      receipt.currencyCode,
      `Cash receipt #${receipt.id} was created with amount=100 in USD but the server stored ` +
        `currencyCode="${receipt.currencyCode}". CreateCashReceiptRequest has no currencyCode ` +
        'field, so CashReceiptService.createPostedCashReceipt() always forces the tenant base ' +
        'currency, silently mislabeling the receipt total.'
    ).toBe('USD');
  });
});
