import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const environments = ['dev', 'local', 'qa', 'staging', 'prod'];
const utilsRoot = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(utilsRoot, '..');
const repoRoot = path.resolve(e2eRoot, '..');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

export function resolveEnvironment(value = process.env.E2E_ENV || 'dev') {
  const environment = value.trim().toLowerCase();
  if (!environments.includes(environment)) {
    throw new Error(`Unsupported E2E_ENV "${environment}". Expected one of: ${environments.join(', ')}.`);
  }
  return environment;
}

export function loadEnvironment(value = process.env.E2E_ENV || 'dev') {
  const environment = resolveEnvironment(value);
  return {
    ...process.env,
    ...readEnvFile(path.join(repoRoot, '.env')),
    ...readEnvFile(path.join(e2eRoot, '.env')),
    ...readEnvFile(path.join(e2eRoot, `${environment}.env`)),
    ...readEnvFile(path.join(e2eRoot, `.env.${environment}`)),
    E2E_ENV: environment,
  };
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function requireValue(environment, names) {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required environment variable. Expected one of: ${names.join(', ')}`);
}

function optionalValue(environment, names) {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return '';
}

export function resolveE2EConfig(value = process.env.E2E_ENV || 'dev') {
  const environment = loadEnvironment(value);
  const baseUrl = withoutTrailingSlash(
    requireValue(environment, ['BASE_URL', 'FRONTEND_BASE_URL', 'E2E_BASE_URL', 'DEV_FRONTEND_URL'])
  );
  const apiUrl = withoutTrailingSlash(
    requireValue(environment, ['API_URL', 'BACKEND_BASE_URL', 'E2E_API_URL', 'DEV_API_URL', 'VITE_API_PROXY_TARGET'])
  );

  return {
    environment: environment.E2E_ENV,
    env: environment,
    baseUrl,
    apiUrl,
    apiRoot: apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`,
    credentials: {
      username: optionalValue(environment, ['TEST_USERNAME', 'E2E_USERNAME']),
      password: optionalValue(environment, ['TEST_PASSWORD', 'E2E_PASSWORD']),
    },
    tenantId: optionalValue(environment, ['TEST_TENANT_ID', 'E2E_TENANT_ID']),
  };
}
