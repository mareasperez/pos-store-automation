/**
 * Tenant creation UI flow — all API calls are mocked with page.route().
 * No real tenants are created; this tests the stepper UX only.
 *
 * Roadmap: once tenant cleanup is implemented, add flows that hit the real API.
 */
import { expect, test } from '@playwright/test';
import { requireCredentialsOrSkip } from '../../support/flows/auth.flow';

const TENANTS_URL = '/platform/tenants';

const MOCK_EXISTING_USER = {
  id: 9001,
  username: 'existing_user_e2e',
  email: 'existing@e2e.test',
  fullName: 'Existing E2E User',
  displayName: 'Existing E2E',
};

const MOCK_TENANT_RESPONSE = {
  id: 'mock-tenant-e2e',
  name: 'E2E Test Tenant',
  active: true,
};

// ── helpers ──────────────────────────────────────────────────────────────

async function openCreateModal(page: import('@playwright/test').Page) {
  await page.goto(TENANTS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /create tenant|crear tenant/i }).first().click();
  await expect(page.locator('.tenant-stepper')).toBeVisible({ timeout: 15_000 });
}

async function fillStep0(page: import('@playwright/test').Page) {
  await page.getByLabel(/organization name|nombre/i).fill('E2E Test Tenant');
  await page.getByLabel(/contact email|email/i).fill('contact@e2etest.com');
  await page.getByRole('button', { name: /next/i }).click();
}

// ── tests ─────────────────────────────────────────────────────────────────

test.describe('Tenant creation stepper (mocked API)', () => {
  test.beforeEach(async () => {
    requireCredentialsOrSkip('tenant creation stepper flows');
  });

  test('@regression @tenants @manual username lookup shows existing-user card', async ({
    page,
  }) => {
    // Mock the lookup endpoint to return an existing user
    await page.route('**/platform/users/lookup?username=existing_user_e2e', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_EXISTING_USER) })
    );

    await openCreateModal(page);
    await fillStep0(page);

    // Step 1 — Root Admin
    await page.getByLabel(/username/i).fill('existing_user_e2e');
    // Wait for debounce (500 ms) and lookup response
    await page.waitForTimeout(800);

    await expect(page.getByText(/usuario existente|existing user/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(MOCK_EXISTING_USER.email)).toBeVisible();

    // Creation fields must be disabled when user exists
    await expect(page.getByLabel(/email/i).nth(0)).toBeDisabled();
  });

  test('@regression @tenants @manual username lookup shows creation form when user not found', async ({
    page,
  }) => {
    // Mock 404 — username not found
    await page.route('**/platform/users/lookup?username=brand_new_user_e2e', (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await openCreateModal(page);
    await fillStep0(page);

    await page.getByLabel(/username/i).fill('brand_new_user_e2e');
    await page.waitForTimeout(800);

    // Creation fields must be enabled
    await expect(page.getByLabel(/email/i).nth(0)).not.toBeDisabled();
    await expect(page.getByText(/usuario existente|existing user/i)).not.toBeVisible();
  });

  test('@regression @tenants @manual full new-user flow reaches confirmation step', async ({
    page,
  }) => {
    await page.route('**/platform/users/lookup?username=new_e2e_root', (route) =>
      route.fulfill({ status: 404, body: '' })
    );

    await openCreateModal(page);
    await fillStep0(page);

    // Fill root admin for new user
    await page.getByLabel(/username/i).fill('new_e2e_root');
    await page.waitForTimeout(800);

    await page.getByLabel(/email/i).nth(0).fill('root@e2etest.com');
    await page.getByLabel(/nombre visible|display name/i).fill('Root E2E');
    await page.getByLabel(/nombre$/i).fill('Root');
    await page.getByLabel(/apellido/i).fill('E2E');
    await page.getByLabel(/contraseña$/i).fill('SecurePass123!');
    await page.getByLabel(/confirmar/i).fill('SecurePass123!');

    await page.getByRole('button', { name: /next/i }).click();

    // Step 2 — confirm: both tenant and user summaries visible
    await expect(page.getByText('E2E Test Tenant')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('new_e2e_root')).toBeVisible();
  });

  test('@regression @tenants @manual full existing-user flow submits via V2 endpoint', async ({
    page,
  }) => {
    await page.route('**/platform/users/lookup?username=existing_user_e2e', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_EXISTING_USER) })
    );

    // Mock V2 create endpoint
    let v2Called = false;
    await page.route('**/v2/tenants', (route) => {
      v2Called = true;
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(MOCK_TENANT_RESPONSE) });
    });
    // Ensure V1 is NOT called
    await page.route('**/api/tenants', (route) => {
      route.fulfill({ status: 500, body: 'V1 should not be called for existing users' });
    });

    await openCreateModal(page);
    await fillStep0(page);

    await page.getByLabel(/username/i).fill('existing_user_e2e');
    await page.waitForTimeout(800);

    await expect(page.getByText(/usuario existente|existing user/i)).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /next/i }).click();
    await page.getByRole('button', { name: /create tenant|crear/i }).click();

    await page.waitForTimeout(1_000);
    expect(v2Called).toBe(true);
  });
});
