import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

const [, , envArg] = process.argv;
const environment = (envArg || process.env.E2E_ENV || 'dev').trim().toLowerCase();

const currentFilePath = fileURLToPath(import.meta.url);
const e2eRoot = path.resolve(path.dirname(currentFilePath), '..');
const repoRoot = path.resolve(e2eRoot, '..');
const authStateFile = path.join(e2eRoot, 'playwright', '.auth', 'user.json');
const postmanCookieFile = path.join(repoRoot, 'postman', '.auth-cookies.json');

function loadEnvFile(filePath) {
  const result = dotenv.config({ path: filePath, override: true, quiet: true });
  return result.parsed ?? {};
}

const rootEnv = loadEnvFile(path.join(repoRoot, '.env'));
const e2eEnv = loadEnvFile(path.join(e2eRoot, '.env'));
const envSpecific = {
  ...loadEnvFile(path.join(e2eRoot, `${environment}.env`)),
  ...loadEnvFile(path.join(e2eRoot, `.env.${environment}`)),
};

function envValue(name) {
  return process.env[name] || envSpecific[name] || e2eEnv[name] || rootEnv[name];
}

function requireOne(names) {
  for (const name of names) {
    const value = envValue(name)?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable. Expected one of: ${names.join(', ')}`);
}

function optional(names) {
  for (const name of names) {
    const value = envValue(name)?.trim();
    if (value) return value;
  }
  return '';
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

async function launchNormalChrome() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error('[auth-setup] Google Chrome was not found. Set E2E_AUTH_CDP_URL manually.');
  }

  const port = 9222;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pos-store-e2e-chrome-'));
  const chrome = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { detached: true, stdio: 'ignore', windowsHide: false }
  );
  chrome.unref();

  const cdpUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return cdpUrl;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('[auth-setup] Chrome did not expose the local debugging endpoint.');
}

const baseUrl = withoutTrailingSlash(
  requireOne(['BASE_URL', 'FRONTEND_BASE_URL', 'E2E_BASE_URL', 'DEV_FRONTEND_URL'])
);
const username = optional(['TEST_USERNAME', 'E2E_USERNAME']);
const password = optional(['TEST_PASSWORD', 'E2E_PASSWORD']);
const tenantId = optional(['TEST_TENANT_ID', 'E2E_TENANT_ID']);
const authHeadless = optional(['E2E_AUTH_HEADLESS']).toLowerCase() === 'true';
let cdpUrl = optional(['E2E_AUTH_CDP_URL']);
if (environment === 'prod') {
  const approvedTenant = optional(['E2E_PROD_TEST_TENANT_ID']);
  if (optional(['E2E_ALLOW_PROD']) !== 'true' || !approvedTenant || tenantId !== approvedTenant) {
    throw new Error(
      '[auth-setup] Production setup requires E2E_ALLOW_PROD=true and TEST_TENANT_ID equal to E2E_PROD_TEST_TENANT_ID.'
    );
  }
}
if (
  !cdpUrl
  && ['dev', 'prod'].includes(environment)
  && optional(['E2E_AUTH_NORMAL_CHROME']).toLowerCase() !== 'false'
) {
  cdpUrl = await launchNormalChrome();
  console.log('[auth-setup] Opened an isolated normal Chrome profile for the dev login.');
}
const manualAuth = Boolean(cdpUrl);

if (!manualAuth && (!username || !password)) {
  console.log('[auth-setup] Skipped: missing TEST_USERNAME/TEST_PASSWORD credentials.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(authStateFile), { recursive: true });

let browser;
let context;
let ownsBrowser = false;
let closeConnectedBrowser = false;

if (cdpUrl) {
  browser = await chromium.connectOverCDP(cdpUrl);
  context = browser.contexts()[0];
  if (!context) {
    throw new Error('[auth-setup] Connected Chrome has no browser context.');
  }
  console.log('[auth-setup] Connected to the existing browser through CDP.');
} else {
  browser = await chromium.launch({ headless: authHeadless });
  context = await browser.newContext({
    locale: 'es',
    timezoneId: 'America/Managua',
    extraHTTPHeaders: {
      'Accept-Language': 'es',
    },
  });
  ownsBrowser = true;
}

const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(`${baseUrl}/login?lng=es`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (manualAuth) {
    if (username && password) {
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill(password);
    }
    console.log(
      '[auth-setup] Credentials filled. Complete Turnstile and click Ingresar in the Chrome window.'
    );
  } else {
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    console.log(
      '[auth-setup] Complete the Turnstile challenge if shown. The script will submit after the login button is enabled.'
    );
    await page.waitForFunction(
      () => !(document.querySelector('button[type="submit"]') instanceof HTMLButtonElement)
        || !document.querySelector('button[type="submit"]').disabled,
      undefined,
      { timeout: 120_000 }
    );
    await page.locator('button[type="submit"]').click();
  }
  await page.waitForURL((url) => !/\/login(?:$|[?#])/i.test(url.pathname + url.search + url.hash), {
    timeout: 30_000,
  });

  // Explicitly pin the active tenant so tests are deterministic even when the user has multiple tenants.
  if (tenantId) {
    // Validate that the user actually has access to this tenant before pinning it.
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('pos_app_store');
      return raw ? JSON.parse(raw) : { state: {} };
    });
    const userTenants = stored?.state?.tenants ?? [];
    const hasAccess = userTenants.some((t) => t.id === tenantId);
    if (!hasAccess) {
      console.error(
        `[auth-setup] FATAL: TEST_TENANT_ID "${tenantId}" is not in the user's tenant list. ` +
        `Available: ${userTenants.map((t) => t.id).join(', ') || '(none loaded yet)'}. ` +
        'Verify the user has been granted access to this tenant.'
      );
      process.exit(1);
    }

    await page.evaluate((id) => {
      const raw = localStorage.getItem('pos_app_store');
      const s = raw ? JSON.parse(raw) : { state: {} };
      s.state.activeTenantId = id;
      localStorage.setItem('pos_app_store', JSON.stringify(s));
    }, tenantId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log(`[auth-setup] Pinned activeTenantId → ${tenantId}`);
  } else {
    console.warn('[auth-setup] TEST_TENANT_ID not set — active tenant will be whatever the app auto-selects.');
  }

  await context.storageState({ path: authStateFile });
  console.log(`[auth-setup] Saved storage state to ${authStateFile}`);

  const authCookies = (await context.cookies()).filter((cookie) =>
    ['access_token', 'refresh_token'].includes(cookie.name)
  );
  fs.writeFileSync(
    postmanCookieFile,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, cookies: authCookies }, null, 2)}\n`,
    { mode: 0o600 }
  );
  console.log(`[auth-setup] Saved Postman cookies to ${postmanCookieFile}`);
} finally {
  if (ownsBrowser) {
    await context.close();
    await browser.close();
  }
}
