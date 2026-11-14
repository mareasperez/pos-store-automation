import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadEnvironment,
  resolveE2EConfigFromEnvironment,
  mergeEnvironment,
} from '../utils/environment.mjs';
import {
  getAllowedTargetOrigins,
  hasDistinctActorIds,
  isConfiguredFrontendOrigin,
  isConfiguredApiRequest,
  isAllowedTargetRequest,
  isRuntimeApiTarget,
  matchesConfiguredTenant,
  selectWorkerAuthState,
} from '../utils/target-policy.mjs';
import { assertProductionRunAllowed } from './production-policy.mjs';

test('replacement workers keep the same distinct cashier sessions by parallel slot', () => {
  const sessions = ['user-0.json', 'user-1.json', 'user-2.json'];
  const initial = [0, 1, 2].map((parallelIndex) =>
    selectWorkerAuthState(sessions, { parallelIndex, workerIndex: parallelIndex })
  );
  const replacement = [0, 1, 2].map((parallelIndex) =>
    selectWorkerAuthState(sessions, { parallelIndex, workerIndex: parallelIndex + 8 })
  );

  assert.deepEqual(initial, sessions);
  assert.deepEqual(replacement, initial);
});

test('explicit process environment overrides every env-file layer', () => {
  const resolved = mergeEnvironment(
    [{ BASE_URL: 'https://file.example', API_URL: 'https://api-file.example' }],
    { BASE_URL: 'https://shell.example', API_URL: 'https://api-shell.example' }
  );

  assert.equal(resolved.BASE_URL, 'https://shell.example');
  assert.equal(resolved.API_URL, 'https://api-shell.example');
});

test('loader preserves explicit URLs and never selects a remote env-file target by default', () => {
  const shellTarget = loadEnvironment(
    'dev',
    { BASE_URL: 'https://shell.example', API_URL: 'https://api-shell.example' },
    {
      shared: [{ BASE_URL: 'https://shared.example', API_URL: 'https://api-shared.example' }],
      specific: [{ BASE_URL: 'https://dev-file.example', API_URL: 'https://api-dev-file.example' }],
    }
  );
  const defaultLocal = loadEnvironment(
    'local',
    {},
    {
      shared: [
        {
          E2E_ENV: 'dev',
          BASE_URL: 'https://dev-file.example',
          API_URL: 'https://api-dev-file.example',
          TEST_USERNAME: 'dev-user',
          TEST_PASSWORD: 'dev-password',
          TEST_USERNAME_2: 'dev-user-2',
          TEST_PASSWORD_2: 'dev-password-2',
          TEST_TENANT_ID: 'dev-tenant',
        },
      ],
      specific: [],
    }
  );

  assert.equal(shellTarget.BASE_URL, 'https://shell.example');
  assert.equal(shellTarget.API_URL, 'https://api-shell.example');
  assert.equal(defaultLocal.BASE_URL, undefined);
  assert.equal(defaultLocal.API_URL, undefined);
  assert.equal(defaultLocal.TEST_USERNAME, undefined);
  assert.equal(defaultLocal.TEST_PASSWORD, undefined);
  assert.equal(defaultLocal.TEST_USERNAME_2, undefined);
  assert.equal(defaultLocal.TEST_PASSWORD_2, undefined);
  assert.equal(defaultLocal.TEST_TENANT_ID, undefined);
  assert.equal(defaultLocal.E2E_ENV, 'local');
});

test('environment-only selection reads target URLs, tenants, users and production gates from its env file', () => {
  const dev = loadEnvironment(
    'dev',
    {},
    {
      shared: [{ E2E_ENV: 'local', BASE_URL: 'http://localhost:5173' }],
      specific: [
        {
          BASE_URL: 'https://dev-file.example',
          API_URL: 'https://api.dev-file.example/api',
          TEST_TENANT_ID: 'dev-tenant',
          TEST_USERNAME: 'dev-user',
          TEST_PASSWORD: 'dev-password',
        },
      ],
    }
  );
  const prod = loadEnvironment(
    'prod',
    {},
    {
      shared: [],
      specific: [
        {
          BASE_URL: 'https://prod-file.example',
          API_URL: 'https://api.prod-file.example/api',
          TEST_TENANT_ID: 'approved-sandbox',
          E2E_PROD_TEST_TENANT_ID: 'approved-sandbox',
          E2E_ALLOW_PROD: 'true',
        },
      ],
    }
  );

  assert.equal(dev.E2E_ENV, 'dev');
  assert.equal(dev.BASE_URL, 'https://dev-file.example');
  assert.equal(dev.API_URL, 'https://api.dev-file.example/api');
  assert.equal(dev.TEST_TENANT_ID, 'dev-tenant');
  assert.equal(dev.TEST_USERNAME, 'dev-user');
  assert.equal(prod.E2E_ENV, 'prod');
  assert.equal(prod.BASE_URL, 'https://prod-file.example');
  assert.doesNotThrow(() =>
    assertProductionRunAllowed(prod, ['tests/smoke/api.spec.ts', '--grep', '@smoke'])
  );
});

test('local is the default target and supplies safe localhost URLs', () => {
  const config = resolveE2EConfigFromEnvironment('local', {});

  assert.equal(config.environment, 'local');
  assert.equal(config.baseUrl, 'http://localhost:5173');
  assert.equal(config.apiUrl, 'http://localhost:8081/api');
  assert.equal(config.apiRoot, 'http://localhost:8081/api');
  assert.throws(
    () =>
      resolveE2EConfigFromEnvironment('local', {
        BASE_URL: 'https://dev.example',
        API_URL: 'https://api.dev.example/api',
      }),
    /select the matching remote environment explicitly/i
  );
});

test('configured development and production targets resolve without fixed tenants', () => {
  const dev = resolveE2EConfigFromEnvironment('dev', {
    BASE_URL: 'https://dev.example/store',
    API_URL: 'https://api.dev.example/api',
    TEST_TENANT_ID: 'dev-tenant',
  });
  const prod = resolveE2EConfigFromEnvironment('prod', {
    BASE_URL: 'https://prod.example',
    API_URL: 'https://api.prod.example/api',
    TEST_TENANT_ID: 'approved-sandbox',
  });

  assert.equal(dev.baseUrl, 'https://dev.example/store');
  assert.equal(dev.apiRoot, 'https://api.dev.example/api');
  assert.equal(dev.tenantId, 'dev-tenant');
  assert.equal(prod.baseUrl, 'https://prod.example');
  assert.equal(prod.tenantId, 'approved-sandbox');
});

test('runtime API must match the configured API, including explicitly configured same-origin proxy paths', () => {
  const config = {
    environment: 'dev',
    baseUrl: 'https://dev.example',
    apiUrl: 'https://api.dev.example/api',
    apiRoot: 'https://api.dev.example/api',
  };
  const proxied = {
    ...config,
    apiUrl: '/api',
    apiRoot: 'https://dev.example/api',
  };

  assert.equal(isRuntimeApiTarget('https://api.dev.example', config), true);
  assert.equal(isRuntimeApiTarget('https://wrong.example', config), false);
  assert.equal(isRuntimeApiTarget('https://api.dev.example/other', config), false);
  assert.equal(isRuntimeApiTarget('/api', proxied), true);
  assert.equal(
    isRuntimeApiTarget('https://dev.example/api', {
      ...proxied,
      apiUrl: 'https://dev.example/',
    }),
    true
  );
});

test('browser API requests must remain under the configured API prefix', () => {
  const config = {
    environment: 'dev',
    baseUrl: 'https://dev.example',
    apiUrl: 'https://api.dev.example/api',
    apiRoot: 'https://api.dev.example/api',
  };
  assert.equal(isConfiguredApiRequest('https://api.dev.example/api/shifts/active', config), true);
  assert.equal(
    isConfiguredApiRequest('https://api.dev.example/other/shifts/active', config),
    false
  );
  assert.equal(
    isConfiguredApiRequest('https://wrong-api.example/api/shifts/active', config),
    false
  );
});

test('configured frontend session matching uses the URL origin, not its path', () => {
  assert.equal(
    isConfiguredFrontendOrigin('https://dev.example', 'https://dev.example/store'),
    true
  );
  assert.equal(
    isConfiguredFrontendOrigin('https://other.example', 'https://dev.example/store'),
    false
  );
});

test('saved sessions must match the configured tenant and parallel actors must be distinct', () => {
  assert.equal(matchesConfiguredTenant('target-tenant', 'target-tenant'), true);
  assert.equal(matchesConfiguredTenant('other-tenant', 'target-tenant'), false);
  assert.equal(matchesConfiguredTenant('target-tenant', ''), false);
  assert.equal(hasDistinctActorIds([12, 34, 56], 3), true);
  assert.equal(hasDistinctActorIds([12, 12, 56], 3), false);
  assert.equal(hasDistinctActorIds([12, 34], 3), false);
});

test('only the configured origins and a runtime-used local API alias are allowed', () => {
  const config = {
    environment: 'local',
    baseUrl: 'http://localhost:5173',
    apiUrl: 'http://localhost:8081/api',
    apiRoot: 'http://localhost:8081/api',
  };

  assert.deepEqual(
    [...getAllowedTargetOrigins(config, 'http://127.0.0.1:8081')].sort(),
    ['http://127.0.0.1:8081', 'http://localhost:5173', 'http://localhost:8081'].sort()
  );
  assert.equal(
    isAllowedTargetRequest(
      'http://127.0.0.1:8081/api/products',
      'GET',
      config,
      'http://127.0.0.1:8081'
    ),
    true
  );
  assert.equal(
    isAllowedTargetRequest(
      'https://other.example/api/products',
      'GET',
      config,
      'http://localhost:8081'
    ),
    false
  );
  assert.equal(
    isAllowedTargetRequest(
      'http://localhost:8081/api/auth/login',
      'POST',
      config,
      'http://localhost:8081'
    ),
    false
  );
  assert.equal(
    isAllowedTargetRequest(
      'http://localhost:8081/api/auth/refresh',
      'POST',
      config,
      'http://localhost:8081'
    ),
    false
  );
  assert.equal(
    isAllowedTargetRequest(
      'http://localhost:8081/api/sessions',
      'POST',
      config,
      'http://localhost:8081'
    ),
    false
  );
  assert.equal(
    isAllowedTargetRequest(
      'http://127.0.0.1:8081/api/products',
      'GET',
      config,
      'http://localhost:8081'
    ),
    false
  );
});

test('production requires explicit consent, the approved tenant, and smoke-only specs', () => {
  const env = {
    E2E_ALLOW_PROD: 'true',
    TEST_TENANT_ID: 'approved-sandbox',
    E2E_PROD_TEST_TENANT_ID: 'approved-sandbox',
  };
  const safeSmokeArgs = [
    'tests/smoke/landing.spec.ts',
    'tests/smoke/api.spec.ts',
    'tests/smoke/tenant-isolation.spec.ts',
    '--grep',
    '@smoke',
  ];

  assert.throws(() => assertProductionRunAllowed({}, safeSmokeArgs), /E2E_ALLOW_PROD/);
  assert.throws(
    () => assertProductionRunAllowed({ ...env, TEST_TENANT_ID: 'different-tenant' }, safeSmokeArgs),
    /E2E_PROD_TEST_TENANT_ID/
  );
  assert.throws(
    () => assertProductionRunAllowed({ ...env, E2E_PROD_TEST_TENANT_ID: undefined }, safeSmokeArgs),
    /E2E_PROD_TEST_TENANT_ID/
  );
  assert.throws(
    () =>
      assertProductionRunAllowed(env, [
        'tests/pos/manual-sale-discount.real.spec.ts',
        '--grep',
        '@serial',
      ]),
    /approved read-only smoke/
  );
  assert.throws(
    () =>
      assertProductionRunAllowed(env, ['tests/smoke/api.spec.ts', 'tests/pos', '--grep', '@smoke']),
    /approved read-only smoke/
  );
  assert.throws(
    () =>
      assertProductionRunAllowed(env, [
        'tests/smoke/api.spec.ts',
        '--grep',
        '@smoke',
        '--config=playwright.config.ts',
      ]),
    /unrecognized or selector-changing/
  );
  assert.throws(
    () =>
      assertProductionRunAllowed(env, [
        'tests/smoke/api.spec.ts',
        '--grep',
        '@smoke',
        '--test-list=selected-tests.txt',
      ]),
    /unrecognized or selector-changing/
  );
  assert.doesNotThrow(() => assertProductionRunAllowed(env, safeSmokeArgs));
  assert.doesNotThrow(() =>
    assertProductionRunAllowed(env, [
      ...safeSmokeArgs,
      '--workers=1',
      '--project=chromium-authenticated',
      '--reporter=list',
      '--headed',
      '--list',
    ])
  );
});
