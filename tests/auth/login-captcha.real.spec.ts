/**
 * Real captcha enforcement check against the deployed API — no UI, forged/missing tokens only.
 * Tag: @real @manual — shares the per-IP rate limit bucket with login-rate-limit.real.spec.ts.
 * Run in isolation, ideally ~60s after any rate-limit run: npx playwright test tests/auth/login-captcha.real.spec.ts
 */
import { expect, test } from '@fixtures';
import { config } from '@config';

const LOGIN_URL = `${config.apiRoot}/auth/login`;

async function probeLogin(
  request: import('@playwright/test').APIRequestContext,
  captchaToken: string | undefined
) {
  const response = await request.post(LOGIN_URL, {
    data: {
      username: `captcha-probe-${Date.now()}`,
      password: 'wrong-password-captcha-probe',
      ...(captchaToken !== undefined ? { captchaToken } : {}),
    },
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

test.describe('@real @manual @auth @login-captcha', () => {
  test('@real @manual a forged captcha token is rejected with 400 CAPTCHA_FAILED', async ({
    request,
  }) => {
    const { status, body } = await probeLogin(request, 'forged-token-not-issued-by-cloudflare');

    test.skip(
      status === 429,
      'IP rate limit window still active from a prior run — wait ~60s and re-run this spec alone.'
    );

    // A non-400 here means the backend accepted a token it never verified with Cloudflare —
    // captcha may be decorative on the UI only. Fail loudly instead of assuming it's fine.
    expect(
      status,
      `Expected 400 CAPTCHA_FAILED for a forged token, got ${status} ${JSON.stringify(body)}.`
    ).toBe(400);
    expect(body?.code).toBe('CAPTCHA_FAILED');
  });

  test('@real @manual a missing captcha token is rejected with 400 CAPTCHA_FAILED', async ({
    request,
  }) => {
    const { status, body } = await probeLogin(request, undefined);

    test.skip(
      status === 429,
      'IP rate limit window still active from a prior run — wait ~60s and re-run this spec alone.'
    );

    expect(
      status,
      `Expected 400 CAPTCHA_FAILED with no token, got ${status} ${JSON.stringify(body)}.`
    ).toBe(400);
    expect(body?.code).toBe('CAPTCHA_FAILED');
  });
});
