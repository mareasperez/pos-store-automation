/**
 * Read-only smoke coverage for the /customer-debt page: list, search, detail dialog, tabs,
 * and the "Ver"/"Registrar pago" placeholders (wired to a shared "not implemented" toast).
 * Non-destructive — nothing is created or mutated, so it runs in the default parallel suite.
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { buildApiHeaders } from '../../support/flows/sales.flow';

interface CustomerDebtSummary {
  customerId: number;
  customerName: string | null;
  totalOutstanding: number;
}

interface PageResponse<T> {
  content: T[];
}

/** Finds an existing customer with a pending balance in the test tenant, or null if none. */
async function findExistingDebtor(page: Page) {
  const headers = await buildApiHeaders(page);
  const res = await page.request.get(
    `${config.apiRoot}/receivables/customers-summary?page=0&size=50`,
    { headers }
  );
  expect(res.ok(), `GET /receivables/customers-summary failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as PageResponse<CustomerDebtSummary>;
  return body.content.find((row) => row.totalOutstanding > 0 && row.customerName) ?? null;
}

test.describe('@regression @customers @customer-debt', () => {
  test('@regression @customers @customer-debt lists a debtor and opens the detail dialog', async ({
    page,
  }) => {
    requireCredentialsOrSkip('customer debt page');

    const debtor = await findExistingDebtor(page);
    test.skip(!debtor, 'No customer with an outstanding balance in the test tenant.');

    await page.goto('/customer-debt?lng=es', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/customer-debt(?:$|[?#])/i, { timeout: 20_000 });

    await page.getByTestId('customer-debt-search').fill(debtor!.customerName!);

    const row = page.getByTestId(`customer-debt-row-${debtor!.customerId}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    await expect(page.getByText(debtor!.customerName!).first()).toBeVisible({ timeout: 10_000 });

    // Default tab is "pending" — switch to "history" and back to confirm both render.
    await page.getByTestId('customer-debt-tab-history').click();
    await expect(page.getByTestId('customer-debt-tab-history')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.getByTestId('customer-debt-tab-pending').click();
    await expect(page.getByTestId('customer-debt-tab-pending')).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await page.getByTestId('customer-debt-register-payment').click();
    await expect(page.getByText(/no implementad|not implemented/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // Scoped to the dialog — react-toastify also renders a "close" icon button globally.
    await page.getByRole('dialog').getByRole('button', { name: /cerrar|close/i }).click();
    await expect(page.getByTestId('customer-debt-register-payment')).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('@regression @customers @customer-debt shows an empty state for a search with no matches', async ({
    page,
  }) => {
    requireCredentialsOrSkip('customer debt page');

    await page.goto('/customer-debt?lng=es', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/customer-debt(?:$|[?#])/i, { timeout: 20_000 });

    await page.getByTestId('customer-debt-search').fill('zzz-no-such-customer-zzz');
    await expect(page.getByText(/no hay clientes con deuda pendiente/i)).toBeVisible({
      timeout: 20_000,
    });
  });
});
