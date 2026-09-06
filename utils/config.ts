import dotenv from 'dotenv';
import path from 'path';

const environments = ['dev', 'qa', 'staging', 'prod'] as const;
type E2EEnvironment = (typeof environments)[number];

function resolveEnvironment(): E2EEnvironment {
  const value = (process.env.E2E_ENV || 'dev').trim().toLowerCase();

  if (environments.includes(value as E2EEnvironment)) {
    return value as E2EEnvironment;
  }

  throw new Error(`Unsupported E2E_ENV "${value}". Expected one of: ${environments.join(', ')}.`);
}

function loadEnvFile(filePath: string): Record<string, string> {
  const result = dotenv.config({ path: filePath, override: true, quiet: true });
  return result.parsed ?? {};
}

const environment = resolveEnvironment();
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../..');

const rootEnv = loadEnvFile(path.join(repoRoot, '.env'));
const e2eEnv = loadEnvFile(path.join(e2eRoot, '.env'));
const environmentEnv = {
  ...loadEnvFile(path.join(e2eRoot, `${environment}.env`)),
  ...loadEnvFile(path.join(e2eRoot, `.env.${environment}`)),
};

function envValue(name: string): string | undefined {
  return process.env[name] || environmentEnv[name] || e2eEnv[name] || rootEnv[name];
}

function requireOne(names: string[]): string {
  for (const name of names) {
    const value = envValue(name)?.trim();
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable. Expected one of: ${names.join(', ')}`);
}

function readOptional(names: string[]): string | undefined {
  for (const name of names) {
    const value = envValue(name)?.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

const baseUrl = withoutTrailingSlash(
  requireOne(['BASE_URL', 'FRONTEND_BASE_URL', 'E2E_BASE_URL', 'DEV_FRONTEND_URL'])
);

const apiUrl = withoutTrailingSlash(
  requireOne(['API_URL', 'BACKEND_BASE_URL', 'E2E_API_URL', 'DEV_API_URL', 'VITE_API_PROXY_TARGET'])
);
const apiRoot = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;

const username = readOptional(['TEST_USERNAME', 'E2E_USERNAME']);
const password = readOptional(['TEST_PASSWORD', 'E2E_PASSWORD']);
const tenantId = readOptional(['TEST_TENANT_ID', 'E2E_TENANT_ID']);

process.env.BASE_URL = baseUrl;
process.env.API_URL = apiUrl;

if (username) {
  process.env.TEST_USERNAME = username;
}

if (password) {
  process.env.TEST_PASSWORD = password;
}

if (tenantId) {
  process.env.TEST_TENANT_ID = tenantId;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}


export const config = {
  environment,
  baseUrl,
  apiUrl,
  apiRoot,
  credentials: {
    username: username ?? '',
    password: password ?? '',
  },
  tenantId: tenantId ?? '',
};
