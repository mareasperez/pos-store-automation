/**
 * Real POS shift integration test — opens a shift from the POS screen.
 * Tag: @real @manual — excluded from automated CI runs.
 * Run: npx playwright test tests/pos/pos-shifts.real.spec.ts
 *
 * Preconditions: auth setup done, frontend + backend running, no active shift.
 * After this test, an open shift exists — run tests/shifts/real.spec.ts to close it.
 */
import { expect, test } from '@playwright/test';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

test.setTimeout(120_000);

test.describe('@real @manual @pos', () => {
  test('@real @manual opens a real shift from the POS screen', async ({ page }) => {
    requireCredentialsOrSkip('real pos open-shift');

    const existing = await page.request.get('/api/shifts/active', {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    test.skip(existing.status() === 200, 'Active shift already exists — close it first from /shifts.');

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
  });

  test('@real @manual closes the active shift from the POS header button', async ({ page }) => {
    requireCredentialsOrSkip('real pos close-shift');

    const existingResp = await page.request.get('/api/shifts/active', {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    test.skip(existingResp.status() !== 200, 'No active shift — run the open-shift test first.');

    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });

    const closeTrigger = page.getByTestId('pos-close-shift');
    await expect(closeTrigger).toBeVisible({ timeout: 20_000 });
    await closeTrigger.click();

    const closeDialog = page.getByTestId('close-shift-modal');
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

    // POS close uses useCloseShift → POST /api/shifts/close (no ID in path)
    const closeResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/close'),
      { timeout: 20_000 }
    );
    await submitBtn.click();

    expect((await closeResponse).status()).toBe(200);

    await expect(page.getByTestId('pos-open-shift').first()).toBeVisible({ timeout: 15_000 });
  });
});
