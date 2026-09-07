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

test.setTimeout(180_000);

async function hasActiveShift(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/shifts/active', {
    headers: { 'X-Tenant-Id': config.tenantId },
  });
  return res.status() === 200;
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
    expect(await hasActiveShift(page)).toBe(false);

    await openShiftFromPos(page);
    expect(await hasActiveShift(page)).toBe(true);

    await closeShiftFromPos(page);
    expect(await hasActiveShift(page)).toBe(false);

    // Leave a till open for POS sale specs that may share this worker.
    await openShiftFromPos(page);
  });
});
