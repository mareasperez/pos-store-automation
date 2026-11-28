import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalProxyTarget } from '../utils/proxy-target.mjs';

const localConfig = {
  environment: 'local',
  baseUrl: 'http://localhost:5173',
  apiUrl: 'http://localhost:8081/api',
};

const matchingProof = {
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

test('local proxy preflight accepts the configured API through a loopback alias', async () => {
  await assert.doesNotReject(() =>
    assertLocalProxyTarget(localConfig, async () => ({
      ok: true,
      json: async () => matchingProof,
    }))
  );
  await assert.doesNotReject(() =>
    assertLocalProxyTarget(
      { ...localConfig, apiUrl: 'http://localhost:8081', apiRoot: 'http://localhost:8081/api' },
      async () => ({ ok: true, json: async () => matchingProof })
    )
  );
  await assert.doesNotReject(() =>
    assertLocalProxyTarget(
      { ...localConfig, apiUrl: 'http://localhost:8081/gateway/api' },
      async () => ({
        ok: true,
        json: async () => ({
          ...matchingProof,
          target: { ...matchingProof.target, pathname: '/gateway' },
        }),
      })
    )
  );
});

test('local proxy preflight rejects remote, wrong-port, and wrong-path upstreams', async () => {
  const mismatches = [
    { ...matchingProof, target: { ...matchingProof.target, hostname: 'api.example.invalid' } },
    { ...matchingProof, target: { ...matchingProof.target, port: '8082' } },
    { ...matchingProof, target: { ...matchingProof.target, pathname: '/other' } },
    { ...matchingProof, proxyContext: '/backend' },
    { ...matchingProof, hasRewrite: true },
  ];

  for (const proof of mismatches) {
    await assert.rejects(
      assertLocalProxyTarget(localConfig, async () => ({ ok: true, json: async () => proof })),
      /local Vite API proxy target does not match/i
    );
  }
  await assert.rejects(
    assertLocalProxyTarget(
      { ...localConfig, apiUrl: 'http://api.example.invalid:8081/api' },
      async () => ({
        ok: true,
        json: async () => ({
          ...matchingProof,
          target: { ...matchingProof.target, hostname: 'api.example.invalid' },
        }),
      })
    ),
    /local Vite API proxy target does not match/i
  );
});

test('local proxy preflight fails closed for missing or malformed proof', async () => {
  for (const response of [
    { ok: false, status: 404, json: async () => ({}) },
    { ok: true, json: async () => null },
    { ok: true, json: async () => ({ proxyContext: '/api', target: {} }) },
    {
      ok: true,
      json: async () => {
        throw new Error('invalid JSON');
      },
    },
  ]) {
    await assert.rejects(assertLocalProxyTarget(localConfig, async () => response));
  }
});

test('local proxy proof is fetched without browser auth or session identity', async () => {
  const requests = [];
  await assertLocalProxyTarget(localConfig, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => matchingProof };
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://localhost:5173/__e2e/proxy-target');
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.deepEqual(requests[0].options.headers, { Accept: 'application/json' });
});

test('non-local targets do not require or fetch a local Vite proxy proof', async () => {
  let fetched = false;
  await assertLocalProxyTarget({ ...localConfig, environment: 'dev' }, async () => {
    fetched = true;
    throw new Error('unexpected probe');
  });
  assert.equal(fetched, false);
});
