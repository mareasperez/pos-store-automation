import { type Page, test } from '@playwright/test';
import { config } from '@config';

export function requireCredentialsOrSkip(flowName: string): void {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    `Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run ${flowName}.`
  );
}

/**
 * Ensures the app is using the expected TEST_TENANT_ID tenant.
 * Call at the start of any test that must operate on a specific tenant.
 * No-op when TEST_TENANT_ID is not configured.
 */
export async function ensureCorrectTenant(page: Page): Promise<void> {
  const tenantId = config.tenantId;
  if (!tenantId) return;

  await page.evaluate((id) => {
    const raw = localStorage.getItem('pos_app_store');
    const stored = raw ? JSON.parse(raw) : { state: {} };
    if (stored.state?.activeTenantId === id) return; // already correct
    stored.state.activeTenantId = id;
    localStorage.setItem('pos_app_store', JSON.stringify(stored));
  }, tenantId);
}