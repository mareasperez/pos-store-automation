import { expect, type Page } from '@playwright/test';

import { config } from '@config';
import { buildApiHeaders } from './apiHeaders';

/** The close action is mounted only after the POS Actions menu opens. */
export function posShiftActions(page: Page) {
  return page.getByRole('button', { name: /^(Acciones|Actions)$/ });
}

export async function selectPosCloseShift(page: Page): Promise<void> {
  await expect(posShiftActions(page)).toBeVisible({ timeout: 20_000 });
  await posShiftActions(page).click();
  const closeItem = page.getByTestId('pos-close-shift');
  await expect(closeItem).toBeVisible();
  await closeItem.click();
}

/** Enter synthetic test counts for every required payment method, not expected balances. */
export async function fillTestShiftCounts(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /^(Cierre de Caja|Close Shift)$/ });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByTestId('shift-close-submit')).toBeEnabled({ timeout: 15_000 });

  const counts = dialog.locator('input[data-testid^="payment-reconciliation-counted-"][required]');
  expect(await counts.count(), 'A shift must have at least one required count').toBeGreaterThan(0);
  for (const count of await counts.all()) {
    await count.fill('0');
  }
  await dialog
    .getByLabel(/Nota de cierre|Closing note/i)
    .fill('Cierre de prueba: conteos simulados');
}

/**
 * Opens the shift from the POS page if the "Abrir Caja" button is visible.
 *
 * Don't pre-decide the branch from a separate `/shifts/active` fetch: that request and the
 * page's own shift query can resolve in either order, so the UI may render "confirm-sale" even
 * when such a check said "no active shift". Let the UI itself pick the branch instead of racing
 * two independent fetches against each other.
 */
export async function openShiftIfPrompted(page: Page): Promise<void> {
  const openButton = page.locator('[data-testid="pos-open-shift"]:visible');
  const confirmButton = page.locator('[data-testid="pos-confirm-sale"]:visible');
  await expect(openButton.or(confirmButton)).toBeAttached({ timeout: 20_000 });

  if (await openButton.isVisible()) {
    const readyToOpen = openButton.and(page.locator(':enabled'));
    await expect(readyToOpen.or(confirmButton).first()).toBeVisible({ timeout: 15_000 });

    if (await confirmButton.isVisible()) {
      return;
    }

    await openButton.click();

    const cashInput = page.getByTestId('shift-initial-cash-input');
    await expect(cashInput).toBeVisible({ timeout: 8_000 });
    await cashInput.fill('1');

    const openResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
      { timeout: 20_000 }
    );
    const submitButton = page.getByTestId('shift-open-submit');
    await expect(submitButton).toBeEnabled({ timeout: 5_000 });
    await submitButton.click();
    expect((await openResponse).status()).toBeLessThan(300);
  }

  await expect(confirmButton).toBeAttached({ timeout: 20_000 });
}

/** True when the tenant currently has an open shift. */
export async function hasActiveShift(page: Page): Promise<boolean> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/shifts/active`, { headers });
  return response.status() === 200;
}

/** Guards the sale POST against a parallel worker closing the tenant-wide shift. */
export async function assertShiftStillActive(page: Page): Promise<void> {
  expect(
    await hasActiveShift(page),
    'Shift was closed after the payment modal opened — a parallel spec closed the tenant shift.'
  ).toBe(true);
}
