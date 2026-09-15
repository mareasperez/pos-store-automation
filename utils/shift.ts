import { expect, type Page } from '@playwright/test';

import { config } from '@config';
import { buildApiHeaders } from './apiHeaders';

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

  if (await openButton.isVisible().catch(() => false)) {
    if (!(await openButton.isEnabled().catch(() => false))) {
      // openButton renders disabled while useActiveShift() resolves. If that resolves to
      // "shift already active", the app unmounts openButton in favor of confirmButton —
      // clicking blindly would wait forever on a target that's about to vanish.
      await Promise.race([
        openButton.and(page.locator(':enabled')).waitFor({ state: 'visible', timeout: 15_000 }),
        confirmButton.waitFor({ state: 'visible', timeout: 15_000 }),
      ]).catch(() => {});
    }

    if (await openButton.isVisible().catch(() => false)) {
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
