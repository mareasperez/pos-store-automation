
import { test, expect } from '@playwright/test';
import { loginAsGlobalAdmin } from './utils/api-auth';

// RBAC tests disabled per user request (not currently important)
test.describe.skip('RBAC API Permissions', () => {
  
  test('Global Admin should access protected platform endpoints', async () => {
    // 1. Login as Global Admin (this also validates env vars)
    const apiContext = await loginAsGlobalAdmin();

    // 2. Access a protected endpoint: /api/platform/users
    // This endpoint lists all users and requires ROLE_GLOBAL_ADMIN
    const response = await apiContext.get('/api/platform/users');

    // 3. Verify access allowed
    console.log(`Global Admin access status: ${response.status()}`);
    if (response.status() !== 200) {
        console.log(`Response body: ${await response.text()}`);
    }
    expect(response.status(), 'Global Admin should have access').toBe(200);

    // 4. Verify data structure (basic check)
    const users = await response.json();
    expect(Array.isArray(users)).toBeTruthy();
    console.log(`Global Admin found ${users.length} users.`);
    if (users.length > 0) {
        expect(users[0]).toHaveProperty('username');
    }
  });

  test('Unauthenticated request should be denied', async ({ request }) => {
    // 1. Direct request without login
    // Note: We use the default test fixture 'request' which is unauthenticated by default
    // unless configured in playwright.config.ts (which it isn't for global setup here)
    // Actually, let's explicitely use a fresh context just to be sure
    const baseURL = process.env.API_URL;
    if (!baseURL) throw new Error("API_URL is missing");

    const response = await request.get(`${baseURL}/api/platform/users`);

    // 2. Verify denial (403 Forbidden or 401 Unauthorized depending on impl)
    // Spring Security usually returns 401 for missing creds, 403 for insufficient perms
    // Since we send NO creds, we expect 401.
    expect([401, 403]).toContain(response.status());
  });

});
