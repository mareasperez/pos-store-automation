import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from '@playwright/test';

const [, , envArg] = process.argv;
const environment = (envArg || process.env.E2E_ENV || 'dev').trim().toLowerCase();

const currentFilePath = fileURLToPath(import.meta.url);
const e2eRoot = path.resolve(path.dirname(currentFilePath), '..');
const repoRoot = path.resolve(e2eRoot, '..');
const authStateFile = path.join(e2eRoot, 'playwright', '.auth', 'user.json');

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

const baseUrl = withoutTrailingSlash(
  requireOne(['BASE_URL', 'FRONTEND_BASE_URL', 'E2E_BASE_URL', 'DEV_FRONTEND_URL'])
);
const username = optional(['TEST_USERNAME', 'E2E_USERNAME']);
const password = optional(['TEST_PASSWORD', 'E2E_PASSWORD']);

if (!username || !password) {
  console.log('[auth-setup] Skipped: missing TEST_USERNAME/TEST_PASSWORD credentials.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(authStateFile), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'es',
  timezoneId: 'America/Managua',
  extraHTTPHeaders: {
    'Accept-Language': 'es',
  },
});
const page = await context.newPage();

try {
  await page.goto(`${baseUrl}/login?lng=es`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/\/login(?:$|[?#])/i.test(url.pathname + url.search + url.hash), {
    timeout: 30_000,
  });

  await context.storageState({ path: authStateFile });
  console.log(`[auth-setup] Saved storage state to ${authStateFile}`);
} finally {
  await context.close();
  await browser.close();
}
