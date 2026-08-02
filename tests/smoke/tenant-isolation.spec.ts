/**
 * Verifies that authenticated tests always operate on the expected tenant.
 * Guards against the scenario where a user has multiple tenants and the app
 * auto-selects the wrong one.
 */
import { expect, test } from '@playwright/test';
import { config } from '@config';
import { ensureCorrectTenant } from '../../support/flows/auth.flow';

test(
  '@smoke @regression @manual active tenant matches TEST_TENANT_ID after login',
  async ({ page }) => {
    test.skip(!config.tenantId, 'Set TEST_TENANT_ID (or E2E_TENANT_ID) to run this check.');

    await page.goto('/?lng=es', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root', { state: 'visible' });

    const activeTenantId: string | null = await page.evaluate(() => {
      const raw = localStorage.getItem('pos_app_store');
      if (!raw) return null;
      return JSON.parse(raw)?.state?.activeTenantId ?? null;
    });

    expect(activeTenantId).toBe(config.tenantId);
  }
);

test(
  '@smoke @regression @manual ensureCorrectTenant helper pins the expected tenant',
  async ({ page }) => {
    test.skip(!config.tenantId, 'Set TEST_TENANT_ID (or E2E_TENANT_ID) to run this check.');

    await page.goto('/?lng=es', { waitUntil: 'domcontentloaded' });

    // Corrupt localStorage to simulate wrong auto-select
    await page.evaluate(() => {
      const raw = localStorage.getItem('pos_app_store');
      const stored = raw ? JSON.parse(raw) : { state: {} };
      stored.state.activeTenantId = 'wrong-tenant-id';
      localStorage.setItem('pos_app_store', JSON.stringify(stored));
    });

    // Helper must restore the correct tenant
    await ensureCorrectTenant(page);

    const activeTenantId: string | null = await page.evaluate(() => {
      const raw = localStorage.getItem('pos_app_store');
      return JSON.parse(raw ?? '{}')?.state?.activeTenantId ?? null;
    });

    expect(activeTenantId).toBe(config.tenantId);
  }
);
