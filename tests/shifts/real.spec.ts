/**
 * Real shift management integration test — opens (if needed), closes from /shifts, then reopens.
 * Tag: @real @manual — excluded from automated CI runs.
 * Run: npx playwright test tests/shifts/real.spec.ts
 *
 * Self-contained: never skips on pre-existing state, and leaves an open till behind.
 *
 * Pinned to cashier 1 (user-0.json) — safe because @shift-serial tests are excluded from
 * the default suite and only run via `npm run test:serial:*` (--workers=1), never
 * concurrently with the parallel pool that also uses cashier 1 for worker 0.
 */
import { authStateFile, expect, serialDescribe, test } from '@fixtures';
import { config } from '@config';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';
import { buildApiHeaders } from '../../support/flows/sales.flow';
import { fillTestShiftCounts } from '../../utils/shift';

test.use({ storageState: authStateFile(0) });
test.setTimeout(120_000);

serialDescribe('@real @manual @shifts @shift-serial', () => {
  test('@real @manual closes a real shift from the /shifts management page', async ({ page }) => {
    requireCredentialsOrSkip('real shift close');

    // Open a shift via POS UI if none is active
    const activeShiftUrl = `${config.apiRoot}/shifts/active`;
    // Cache-Control: no-cache is required — page.request can replay a stale cached 200/204 for
    // this exact URL, which is fatal here since this test intentionally leaves a shift open behind.
    // Authorization/Cookie must be attached manually: our stored cookies are scoped to `localhost`
    // (the browser talks to the API via the Vite proxy), so a direct cross-domain request to
    // config.apiRoot never gets them auto-attached by the context's cookie jar — 401 otherwise.
    const existingResp = await page.request.get(activeShiftUrl, {
      headers: { ...(await buildApiHeaders(page)), 'Cache-Control': 'no-cache' },
    });
    expect([200, 204], `Unexpected active shift response: ${existingResp.status()}`).toContain(
      existingResp.status()
    );
    if (existingResp.status() === 204) {
      await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
      const openTrigger = page.locator('[data-testid="pos-open-shift"]:visible');
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
      headers: { ...(await buildApiHeaders(page)), 'Cache-Control': 'no-cache' },
    });
    expect(activeResp.status()).toBe(200);
    expect(activeResp.headers()['content-type']).toContain('application/json');
    const shiftId: number = ((await activeResp.json()) as { id: number }).id;

    await page.goto('/shifts?lng=es', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shifts/, { timeout: 20_000 });

    // The close action lives inside the row actions dropdown, which mounts only once opened.
    const actionsBtn = page.getByTestId(`shift-actions-${shiftId}`);
    await expect(actionsBtn).toBeVisible({ timeout: 20_000 });
    await actionsBtn.click();

    const closeBtn = page.getByTestId(`shift-close-btn-${shiftId}`);
    await closeBtn.waitFor({ state: 'attached', timeout: 5_000 }); // Dropdown mounts after click
    await expect(closeBtn).toBeVisible({ timeout: 10_000 });
    await closeBtn.click();

    const closeDialog = page.getByRole('dialog', { name: /^(Cierre de Caja|Close Shift)$/ });
    await expect(closeDialog).toBeVisible({ timeout: 10_000 });
    await fillTestShiftCounts(page);

    const submitBtn = closeDialog.getByTestId('shift-close-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });

    const closeResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/shifts/${shiftId}/close`,
      { timeout: 20_000 }
    );
    await submitBtn.click();

    expect((await closeResponse).status()).toBe(200);

    await expect(closeBtn).not.toBeVisible({ timeout: 15_000 });

    // Leave a till open for POS specs that may share this worker.
    await page.goto('/pos?lng=es', { waitUntil: 'domcontentloaded' });
    const reopenTrigger = page.locator('[data-testid="pos-open-shift"]:visible');
    await expect(reopenTrigger).toBeVisible({ timeout: 20_000 });
    await expect(reopenTrigger).toBeEnabled({ timeout: 20_000 });
    await reopenTrigger.click();
    await expect(page.getByTestId('shift-initial-cash-input')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('shift-initial-cash-input').fill('100');
    const reopenResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/shifts/open'),
      { timeout: 20_000 }
    );
    await page.getByTestId('shift-open-submit').click();
    expect((await reopenResponse).status()).toBe(200);
  });
});
