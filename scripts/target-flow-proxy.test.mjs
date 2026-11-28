import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import ts from 'typescript';
import { assertLocalProxyTarget } from '../utils/proxy-target.mjs';
import * as policy from '../utils/target-policy.mjs';

const file = fileURLToPath(new URL('../support/flows/target.flow.ts', import.meta.url));
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2021,
    esModuleInterop: true,
  },
}).outputText;

const config = {
  environment: 'local',
  baseUrl: 'http://localhost:5173',
  apiUrl: 'http://localhost:8081',
  apiRoot: 'http://localhost:8081/api',
  tenantId: 'dummy-tenant',
};
const proof = {
  proxyContext: '/api',
  hasRewrite: false,
  target: {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '8081',
    pathname: '/',
    hasCredentials: false,
    hasQuery: false,
    hasHash: false,
  },
};

function harness(selectedConfig, response, requests) {
  const events = [];
  const fetchProof = async (url, options) => {
    events.push(['proof', url, options.credentials]);
    if (response instanceof Error) throw response;
    return response;
  };
  const modules = {
    '@fixtures': { expect },
    '@config': { config: selectedConfig },
    '../../utils/target-policy.mjs': policy,
    '../../utils/proxy-target.mjs': {
      assertLocalProxyTarget: (target) => assertLocalProxyTarget(target, fetchProof),
    },
  };
  const exports = {};
  vm.runInNewContext(
    compiled,
    {
      exports,
      require(name) {
        if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
        return modules[name];
      },
      URL,
      setTimeout,
      clearTimeout,
    },
    { filename: file }
  );
  let handler;
  const context = {
    async storageState() {
      return {
        origins: [
          {
            origin: new URL(selectedConfig.baseUrl).origin,
            localStorage: [
              {
                name: 'pos_app_store',
                value: JSON.stringify({
                  state: {
                    activeTenantId: selectedConfig.tenantId,
                    tenants: [{ id: selectedConfig.tenantId }],
                    user: { permissions: [] },
                  },
                }),
              },
            ],
          },
        ],
      };
    },
    async route(_pattern, routeHandler) {
      handler = routeHandler;
    },
  };
  async function dispatch({
    url,
    method = 'GET',
    headers = { 'x-tenant-id': selectedConfig.tenantId },
  }) {
    const request = {
      url: () => url,
      method: () => method,
      headers: () => headers,
      resourceType: () => 'fetch',
    };
    await handler({
      request: () => request,
      async abort() {
        events.push(['abort', url]);
      },
      async fallback() {
        events.push(['fallback', url]);
      },
    });
  }
  const page = {
    context: () => context,
    async goto() {
      events.push(['navigate']);
      for (const request of requests) await dispatch(request);
    },
  };
  return { ...exports, page, events, fetchProof, dispatch };
}

test('real guard accepts the local browser proxy only after real matching proof', async () => {
  const api = `${config.baseUrl}/api/products`;
  const h = harness(config, { ok: true, json: async () => proof }, [{ url: api, headers: {} }]);
  // Simulate the real global setup proof; the worker guard must not rely on an unchecked flag.
  await assertLocalProxyTarget(config, h.fetchProof);
  const assertRequests = await h.assertConfiguredTarget(h.page);
  assertRequests();
  assert.deepEqual(
    h.events.map(([event]) => event),
    ['proof', 'proof', 'navigate', 'fallback']
  );
  assert.equal(h.events[1][1], `${config.baseUrl}/__e2e/proxy-target`);
  assert.equal(h.events[1][2], 'omit');
});

test('local proxy failure prevents navigation and never accepts missing or mismatched proof', async () => {
  for (const response of [
    new Error('offline'),
    { ok: false },
    {
      ok: true,
      json: async () => {
        throw new Error('malformed');
      },
    },
    {
      ok: true,
      json: async () => ({ ...proof, target: { ...proof.target, hostname: 'remote.invalid' } }),
    },
    { ok: true, json: async () => ({ ...proof, target: { ...proof.target, port: '8082' } }) },
  ]) {
    const h = harness({ ...config, localProxyVerified: true }, response, [
      { url: `${config.baseUrl}/api/products` },
    ]);
    await assert.rejects(h.assertConfiguredTarget(h.page), /local Vite API proxy target/i);
    assert.deepEqual(
      h.events.map(([event]) => event),
      ['proof']
    );
  }
});

test('guard preserves API boundaries, auth/write blocking and Sentry isolation', async () => {
  for (const [url, method, error] of [
    [`${config.baseUrl}/apiary/products`, 'GET', /target mismatch/i],
    [`${config.baseUrl}/api/auth/refresh`, 'POST', /blocked .* refresh/i],
    [`${config.baseUrl}/api/sales`, 'POST', /blocked mutation/i],
    ['https://wrong.invalid/api/products', 'GET', /target mismatch/i],
  ]) {
    const h = harness(config, { ok: true, json: async () => proof }, [{ url, method }]);
    await assert.rejects(h.assertConfiguredTarget(h.page), error);
    assert.ok(h.events.some(([event, destination]) => event === 'abort' && destination === url));
  }
  const sentry = 'https://o1.ingest.us.sentry.io/api/1/envelope/';
  const api = `${config.apiRoot}/products`;
  const h = harness(config, { ok: true, json: async () => proof }, [
    { url: sentry, method: 'POST', headers: {} },
    { url: api },
  ]);
  (await h.assertConfiguredTarget(h.page))();
  assert.ok(h.events.some(([event, url]) => event === 'abort' && url === sentry));
  assert.ok(h.events.some(([event, url]) => event === 'fallback' && url === api));
});

test('after the read-only probe, proxy mutations remain allowed but auth remains blocked', async () => {
  const h = harness(config, { ok: true, json: async () => proof }, [
    { url: `${config.baseUrl}/api/products` },
  ]);
  const assertRequests = await h.assertConfiguredTarget(h.page);
  const sale = `${config.baseUrl}/api/sales`;
  const refresh = `${config.baseUrl}/api/auth/refresh`;
  await h.dispatch({ url: sale, method: 'POST' });
  await h.dispatch({ url: refresh, method: 'POST' });
  assert.ok(h.events.some(([event, url]) => event === 'fallback' && url === sale));
  assert.ok(h.events.some(([event, url]) => event === 'abort' && url === refresh));
  assert.throws(assertRequests, /No login, refresh, or session creation/);
});

test('non-local guard keeps direct target behavior without proxy proof', async () => {
  const dev = {
    ...config,
    environment: 'dev',
    baseUrl: 'https://ui.example.invalid',
    apiUrl: 'https://api.example.invalid/api',
    apiRoot: 'https://api.example.invalid/api',
  };
  const allowed = harness(dev, new Error('must not fetch'), [{ url: `${dev.apiRoot}/products` }]);
  (await allowed.assertConfiguredTarget(allowed.page))();
  assert.deepEqual(
    allowed.events.map(([event]) => event),
    ['navigate', 'fallback']
  );
  const rejected = harness(dev, new Error('must not fetch'), [
    { url: `${dev.baseUrl}/api/products` },
  ]);
  await assert.rejects(rejected.assertConfiguredTarget(rejected.page), /target mismatch/i);
});
