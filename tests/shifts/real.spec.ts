/**
 * Real shift management integration test — opens (if needed) and closes a shift from /shifts.
 * Tag: @real @manual — excluded from automated CI runs.
 * Run: npx playwright test tests/shifts/real.spec.ts
 *
 * Preconditions: auth setup done, frontend + backend running.
 * Opens a shift automatically if none is active.
 */
import { expect, test } from '@playwright/test';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

test.setTimeout(120_000);

test.describe('@real @manual @shifts', () => {
  test('@real @manual closes a real shift from the /shifts management page', async ({ page }) => {
    requireCredentialsOrSkip('real shift close');

    // Open a shift via POS UI if none is active
    const activeShiftUrl = `${config.apiRoot}/shifts/active`;
    const existingResp = await page.request.get(activeShiftUrl, {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    if (existingResp.status() !== 200) {
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
    }

    const activeResp = await page.request.get(activeShiftUrl, {
      headers: { 'X-Tenant-Id': config.tenantId },
    });
    expect(activeResp.status()).toBe(200);
    expect(activeResp.headers()['content-type']).toContain('application/json');
    const shiftId: number = ((await activeResp.json()) as { id: number }).id;

    await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shifts/, { timeout: 20_000 });

    // The close action lives inside the row actions dropdown, which mounts only once opened.
    const actionsBtn = page.getByTestId(`shift-actions-${shiftId}`);
    await expect(actionsBtn).toBeVisible({ timeout: 20_000 });
    await actionsBtn.click();

    const closeBtn = page.getByTestId(`shift-close-btn-${shiftId}`);
    await closeBtn.waitFor({ state: 'attached', timeout: 5_000 }); // Dropdown mounts after click
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await closeBtn.click();

    const closeDialog = page.getByTestId('close-shift-modal');
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });

    // Wait for payment methods to load — the useEffect initializes reconciliations only after
    // paymentMethods arrive; submitting before that sends an empty array → 400.
    await expect(closeDialog.getByText(/contado/i).first()).toBeVisible({ timeout: 15_000 });

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });

    // Fill close note to satisfy the discrepancy-note requirement (real shift likely has expected amounts)
    await closeDialog.getByTestId('shift-close-note').fill('Cierre de prueba automático');

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
