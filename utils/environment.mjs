import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const environments = ['dev', 'local', 'qa', 'staging', 'prod'];
const defaultEnvironment = 'local';
const localBaseUrl = 'http://localhost:5173';
const localApiUrl = 'http://localhost:8081/api';
const utilsRoot = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(utilsRoot, '..');
const repoRoot = path.resolve(e2eRoot, '..');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath));
}

export function resolveEnvironment(value = process.env.E2E_ENV || defaultEnvironment) {
  const environment = value.trim().toLowerCase();
  if (!environments.includes(environment)) {
    throw new Error(
      `Unsupported E2E_ENV "${environment}". Expected one of: ${environments.join(', ')}.`
    );
  }
  return environment;
}

export function mergeEnvironment(fileEnvironments = [], shellEnvironment = process.env) {
  return Object.assign({}, ...fileEnvironments, shellEnvironment);
}

export function loadEnvironment(
  value = process.env.E2E_ENV || defaultEnvironment,
  shellEnvironment = process.env,
  fileLayers
) {
  const environment = resolveEnvironment(value);
  const sharedFiles = fileLayers?.shared ?? [
    readEnvFile(path.join(repoRoot, '.env')),
    readEnvFile(path.join(e2eRoot, '.env')),
  ];
  const environmentFiles = fileLayers?.specific ?? [
    readEnvFile(path.join(e2eRoot, `${environment}.env`)),
    readEnvFile(path.join(e2eRoot, `.env.${environment}`)),
  ];
  const layers = [...sharedFiles, ...environmentFiles];
  const resolved = mergeEnvironment(layers, shellEnvironment);
  const declaredEnvironment = [...sharedFiles]
    .reverse()
    .map((file) => file.E2E_ENV?.trim().toLowerCase())
    .find(Boolean);

  if (environment === 'local' && declaredEnvironment && declaredEnvironment !== 'local') {
    const targetAndCredentialKeys = [
      'BASE_URL',
      'FRONTEND_BASE_URL',
      'E2E_BASE_URL',
      'DEV_FRONTEND_URL',
      'API_URL',
      'BACKEND_BASE_URL',
      'E2E_API_URL',
      'DEV_API_URL',
      'VITE_API_PROXY_TARGET',
      'TEST_TENANT_ID',
      'E2E_TENANT_ID',
    ];
    for (const key of Object.keys(resolved)) {
      if (
        targetAndCredentialKeys.includes(key) ||
        /^(?:TEST|E2E)_(?:USERNAME|PASSWORD)(?:_\d+)?$/.test(key)
      ) {
        delete resolved[key];
      }
    }
    Object.assign(resolved, mergeEnvironment(environmentFiles, shellEnvironment));
  }

  return {
    ...resolved,
    E2E_ENV: environment,
  };
}

function normalizeUrl(value, name, baseUrl) {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be a valid HTTP(S) URL without embedded credentials.`);
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

function isLoopback(value) {
  const hostname = new URL(value).hostname;
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
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

export function resolveE2EConfigFromEnvironment(value = defaultEnvironment, environment = {}) {
  const environmentName = resolveEnvironment(value);
  const rawBaseUrl =
    optionalValue(environment, [
      'BASE_URL',
      'FRONTEND_BASE_URL',
      'E2E_BASE_URL',
      'DEV_FRONTEND_URL',
    ]) || (environmentName === 'local' ? localBaseUrl : '');
  if (!rawBaseUrl) {
    throw new Error(
      'Missing required environment variable. Expected one of: BASE_URL, FRONTEND_BASE_URL, E2E_BASE_URL, DEV_FRONTEND_URL'
    );
  }
  const baseUrl = normalizeUrl(rawBaseUrl, 'BASE_URL');
  const rawApiUrl =
    optionalValue(environment, [
      'API_URL',
      'BACKEND_BASE_URL',
      'E2E_API_URL',
      'DEV_API_URL',
      'VITE_API_PROXY_TARGET',
    ]) || (environmentName === 'local' ? localApiUrl : '');
  if (!rawApiUrl) {
    throw new Error(
      'Missing required environment variable. Expected one of: API_URL, BACKEND_BASE_URL, E2E_API_URL, DEV_API_URL, VITE_API_PROXY_TARGET'
    );
  }
  const apiUrl = normalizeUrl(rawApiUrl, 'API_URL', baseUrl);
  if (environmentName === 'local' && (!isLoopback(baseUrl) || !isLoopback(apiUrl))) {
    throw new Error(
      'E2E_ENV=local accepts localhost targets only. Select the matching remote environment explicitly.'
    );
  }

  return {
    environment: environmentName,
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

export function resolveE2EConfig(value = process.env.E2E_ENV || defaultEnvironment) {
  const environment = loadEnvironment(value);
  return resolveE2EConfigFromEnvironment(value, environment);
}
