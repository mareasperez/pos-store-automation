/**
 * Real anti-brute-force check against the deployed API — no UI, no valid credentials needed.
 * Tag: @real @manual — this trips the login rate limiter, which then blocks logins from this
 * machine's IP for up to a minute (shared across every other login in the suite).
 * Run in isolation: npx playwright test tests/auth/login-rate-limit.real.spec.ts
 */
import { expect, test } from '@fixtures';
import { config } from '@config';

const LOGIN_URL = `${config.apiRoot}/auth/login`;
const MAX_ATTEMPTS = 20;

test.describe('@real @manual @auth @login-rate-limit', () => {
  test('@real @manual repeated login attempts eventually get rate-limited with 429', async ({
    request,
  }) => {
    // Nonexistent user on purpose: the rate limiter runs before authentication, so invalid
    // credentials never even reach AuthService.login — only the throttling matters here.
    const username = `bruteforce-test-${Date.now()}`;
    const statuses: number[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const response = await request.post(LOGIN_URL, {
        data: { username, password: 'wrong-password-anti-bruteforce' },
      });
      statuses.push(response.status());
      if (response.status() === 429) break;
    }

    expect(
      statuses,
      `Got ${statuses.length} responses (${statuses.join(', ')}) without a 429. Either the ` +
        'rate limiter is disabled, or its limits are configured looser than expected here.'
    ).toContain(429);
  });
});
