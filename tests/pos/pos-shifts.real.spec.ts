/**
 * Real POS shift integration test — exercises the full open → close → reopen cycle.
 * Tag: @real @manual — excluded from automated CI runs.
 * Run: npx playwright test tests/pos/pos-shifts.real.spec.ts
 *
 * Self-contained: closes any pre-existing shift for this cashier, runs the cycle, and leaves an
 * open shift behind so POS sale specs sharing this worker still find a till.
 */
import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { buildApiHeaders } from '../../support/flows/sales.flow';

test.setTimeout(180_000);

/** The endpoint answers 204 when the cashier has no open till, 200 with the shift otherwise. */
async function hasActiveShift(page: Page): Promise<boolean> {
  // Absolute URL on purpose: a relative path resolves against baseURL (the SPA), which answers
  // 200 with index.html for unknown routes and would make this always report an open shift.
  // Authorization/Cookie must be attached manually: our stored cookies are scoped to `localhost`
  // (the browser talks to the API via the Vite proxy), so a direct cross-domain request to
  // config.apiRoot never gets them auto-attached by the context's cookie jar — 401 otherwise.
  const res = await page.request.get(`${config.apiRoot}/shifts/active`, {
    headers: {
      ...(await buildApiHeaders(page)),
      // page.request shares the browser cache; without this the app's earlier 200 can come back.
      'Cache-Control': 'no-cache',
    },
  });
  return res.status() === 200;
}

/** The UI reflects the mutation before the server settles, so poll instead of reading once. */
async function expectShiftState(page: Page, open: boolean, because: string): Promise<void> {
  await expect
    .poll(() => hasActiveShift(page), { timeout: 20_000, message: because })
    .toBe(open);
}

/** Opens a shift from the POS screen and asserts the server accepted it. */
async function openShiftFromPos(page: Page): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

  const openTrigger = page.getByTestId('pos-open-shift').first();
  await expect(openTrigger).toBeVisible({ timeout: 20_000 });
  await openTrigger.click();

  await expect(page.getByTestId('shift-initial-cash-input')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('shift-initial-cash-input').fill('100');

  const openResponse = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
    { timeout: 20_000 }
  );
  await page.getByTestId('shift-open-submit').click();

  expect((await openResponse).status()).toBe(200);
  await expect(page.getByTestId('pos-close-shift')).toBeVisible({ timeout: 15_000 });
}

/** Closes the active shift from the POS header and asserts the server accepted it. */
async function closeShiftFromPos(page: Page): Promise<void> {
  await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

  const closeTrigger = page.getByTestId('pos-close-shift');
  await expect(closeTrigger).toBeVisible({ timeout: 20_000 });
  await closeTrigger.click();

  const closeDialog = page.getByTestId('close-shift-modal');
  await expect(closeDialog).toBeVisible({ timeout: 10_000 });

  const submitBtn = closeDialog.getByTestId('shift-close-submit');
  await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

  // Note is required whenever the count differs from expectations, which a real shift usually does.
  await closeDialog.getByTestId('shift-close-note').fill('Cierre de prueba automático');

  // POS close uses useCloseShift → POST /api/shifts/close OR /api/shifts/{id}/close
  const closeResponse = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      r.url().includes('/api/shifts') &&
      r.url().endsWith('/close'),
    { timeout: 20_000 }
  );
  await submitBtn.click();

  expect((await closeResponse).status()).toBe(200);
  await expect(page.getByTestId('pos-open-shift').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('@real @manual @pos @shift-destructive', () => {
  test('@real @manual opens and closes a real shift from the POS screen', async ({ page }) => {
    requireCredentialsOrSkip('real pos shift cycle');

    // Start from a known state instead of skipping when a shift is already open.
    if (await hasActiveShift(page)) {
      await closeShiftFromPos(page);
    }
    await expectShiftState(page, false, 'pre-existing shift should be closed before the cycle');

    await openShiftFromPos(page);
    await expectShiftState(page, true, 'shift should be open after opening it from the POS');

    await closeShiftFromPos(page);
    await expectShiftState(page, false, 'shift should be closed after closing it from the POS');

    // Leave a till open for POS sale specs that may share this worker.
    await openShiftFromPos(page);
    await expectShiftState(page, true, 'a till must be left open for the POS sale specs');
  });
});
