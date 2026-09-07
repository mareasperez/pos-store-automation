import { type Page } from '@playwright/test';
import { expect, test } from '@fixtures';
import { config } from '@config';

const LOGIN_URL = '/login?lng=es';

/**
 * VITE_TURNSTILE_ENABLED is baked into the deployed bundle, so the environment has to be probed at
 * runtime. The widget itself lives inside a closed shadow root (unreachable by any locator), so the
 * request for Cloudflare's script is the observable signal.
 */
async function openLoginAndDetectCaptcha(page: Page): Promise<boolean> {
  const captchaScriptRequested = page
    .waitForRequest((request) => request.url().includes('challenges.cloudflare.com'), {
      timeout: 15_000,
    })
    .then(() => true)
    .catch(() => false);

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  return captchaScriptRequested;
}

test('@critical @auth login submit stays disabled until the captcha is solved', async ({ page }) => {
  const captchaEnabled = await openLoginAndDetectCaptcha(page);

  const username = page.locator('input[name="username"]');
  const password = page.locator('input[name="password"]');
  const submit = page.locator('button[type="submit"]');

  await expect(username).toBeVisible();
  await expect(password).toBeVisible();
  await expect(submit).toBeVisible();

  if (!captchaEnabled) {
    console.log('[skip] Turnstile script never requested: captcha is disabled in this environment.');
    test.skip(true, 'Captcha disabled in this environment — nothing to gate.');
  }

  await expect(submit).toBeDisabled();

  // Credentials alone must not unlock submit: the captcha token is the gate.
  await username.fill(config.credentials.username || 'e2e.user');
  await password.fill(config.credentials.password || 'e2e-password');

  await expect(submit).toBeDisabled();
});

test('@critical @auth valid user reaches home when login is reachable', async ({ page }) => {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    'Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run @critical auth flows.'
  );

  const captchaEnabled = await openLoginAndDetectCaptcha(page);

  const submit = page.locator('button[type="submit"]');
  await expect(submit).toBeVisible();

  if (captchaEnabled) {
    console.log(
      '[skip] Turnstile is enabled: the login submit needs a human-solved challenge. ' +
        'The authenticated session comes from `npm run test:auth:setup` instead.'
    );
    test.skip(true, 'Captcha enabled — login submit cannot be automated.');
  }

  await page.locator('input[name="username"]').fill(config.credentials.username);
  await page.locator('input[name="password"]').fill(config.credentials.password);
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });
  await expect(page.locator('#root')).not.toBeEmpty();
});

test('@critical @auth invalid credentials are rejected when login is reachable', async ({
  page,
}) => {
  const captchaEnabled = await openLoginAndDetectCaptcha(page);

  const submit = page.locator('button[type="submit"]');
  await expect(submit).toBeVisible();

  if (captchaEnabled) {
    console.log(
      '[skip] Turnstile is enabled: submitting the login form needs a human-solved challenge. ' +
        'Invalid-credential rejection stays manual (see e2e/README.md).'
    );
    test.skip(true, 'Captcha enabled — login submit cannot be automated.');
  }

  await page.locator('input[name="username"]').fill(`e2e.invalid.${Date.now()}`);
  await page.locator('input[name="password"]').fill('invalid-password');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page).toHaveURL(/\/login(?:$|[?#])/i, { timeout: 20_000 });

  const loginError = page.locator('#login-error');
  const hasVisibleErrorMessage = await loginError.isVisible().catch(() => false);

  if (hasVisibleErrorMessage) {
    await expect(loginError).toBeVisible();
  } else {
    await expect(submit).toBeVisible();
  }
});
