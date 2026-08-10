/**
 * Real shift management integration test — closes a shift from the /shifts page.
 * Tag: @real @manual — excluded from automated CI runs.
 * Run: npx playwright test tests/shifts/real.spec.ts
 *
 * Preconditions: auth setup done, frontend + backend running, an active shift exists.
 * To open a shift first, run tests/pos/pos-shifts.real.spec.ts.
 */
import { expect, test } from '@playwright/test';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

test.setTimeout(120_000);

test.describe('@real @manual @shifts', () => {
  test('@real @manual closes a real shift from the /shifts management page', async ({ page }) => {
    requireCredentialsOrSkip('real shift close');

    const existingResp = await page.request.get('/api/shifts/active', {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    test.skip(existingResp.status() !== 200, 'No active shift — run the open-shift test first.');

    const shiftId: number = (await existingResp.json()).id;

    await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shifts/, { timeout: 20_000 });

    const closeBtn = page.getByTestId(`shift-close-btn-${shiftId}`);
    await expect(closeBtn).toBeVisible({ timeout: 20_000 });
    await closeBtn.click();

    const closeDialog = page.getByTestId('close-shift-modal');
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

    const closeResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/shifts/${shiftId}/close`,
      { timeout: 20_000 }
    );
    await submitBtn.click();

    expect((await closeResponse).status()).toBe(200);

    await expect(closeBtn).not.toBeVisible({ timeout: 15_000 });
  });
});
