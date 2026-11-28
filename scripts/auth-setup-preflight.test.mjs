import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { getEnvironmentPaths } from '../utils/environment-paths.mjs';
import { assertLocalProxyTarget } from '../utils/proxy-target.mjs';

const script = fileURLToPath(new URL('./create-auth-state.mjs', import.meta.url));
const source = fs
  .readFileSync(script, 'utf8')
  .replaceAll(
    'import.meta.url',
    JSON.stringify(new URL('./create-auth-state.mjs', import.meta.url).href)
  );
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
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

async function runAuthSetup(environment, proof, browserMode = 'headless') {
  const calls = [];
  const target = {
    environment,
    baseUrl: 'http://localhost:5179',
    apiUrl: 'http://localhost:8081',
    apiRoot: 'http://localhost:8081/api',
    tenantId: '',
    env: {
      get TEST_USERNAME() {
        calls.push('credentials');
        return 'dummy';
      },
      get TEST_PASSWORD() {
        calls.push('credentials');
        return 'dummy';
      },
      E2E_AUTH_NORMAL_CHROME: browserMode === 'normal' ? 'true' : 'false',
      E2E_AUTH_CDP_URL: browserMode === 'cdp' ? 'http://localhost:9222' : '',
    },
  };
  const modules = {
    'node:fs': {
      mkdirSync() {
        calls.push('mkdir');
      },
      existsSync() {
        return true;
      },
      mkdtempSync() {
        calls.push('profile');
        return 'dummy-profile';
      },
    },
    'node:path': path,
    'node:child_process': {
      spawn() {
        calls.push('spawn');
        throw new Error('stopped before browser launch');
      },
    },
    'node:os': { tmpdir: () => 'dummy-parent' },
    'node:url': { fileURLToPath },
    '@playwright/test': {
      chromium: {
        async launch() {
          calls.push('launch');
          throw new Error('stopped before browser launch');
        },
        async connectOverCDP() {
          calls.push('connect');
          throw new Error('stopped before browser launch');
        },
      },
    },
    './auth-login.mjs': {},
    '../utils/environment.mjs': {
      resolveEnvironment: (value) => value,
      resolveE2EConfig: () => target,
    },
    '../utils/environment-paths.mjs': {
      getEnvironmentPaths,
      clearEnvironmentAuthState() {
        calls.push('cleanup');
      },
    },
    '../utils/proxy-target.mjs': {
      async assertLocalProxyTarget(config) {
        calls.push(['preflight', config]);
        return assertLocalProxyTarget(config, async (url, options) => {
          calls.push(['fetch', url, options]);
          if (proof instanceof Error) throw proof;
          return proof;
        });
      },
    },
    './production-policy.mjs': {},
    './runner-args.mjs': { parseRunnerArgs: () => ({ environment }) },
  };
  const context = {
    exports: {},
    require(name) {
      if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
      return modules[name];
    },
    process: {
      argv: [],
      env: {},
      exit() {
        throw new Error('unexpected exit');
      },
    },
    console,
    URL,
    setTimeout,
  };
  try {
    await vm.runInNewContext(`(async () => { ${compiled}\n})()`, context, { filename: script });
    throw new Error('setup unexpectedly completed');
  } catch (error) {
    return { calls, error, target };
  }
}

test('auth setup rejects unsafe local proxy proof before cleanup and browser launch', async () => {
  for (const mode of ['headless', 'normal', 'cdp']) {
    for (const proof of [
      new Error('unreachable'),
      { ok: false },
      { ok: true, json: async () => null },
      {
        ok: true,
        json: async () => ({
          ...matchingProof,
          target: { ...matchingProof.target, hostname: 'remote.invalid' },
        }),
      },
      {
        ok: true,
        json: async () => ({ ...matchingProof, target: { ...matchingProof.target, port: '8082' } }),
      },
    ]) {
      const { calls, error } = await runAuthSetup('local', proof, mode);
      assert.match(error.message, /local Vite API proxy target/i);
      assert.deepEqual(
        calls.map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
        ['preflight', 'fetch']
      );
    }
  }
});

test('auth setup uses resolved target before cleanup and launch, and skips probing non-local', async () => {
  for (const environment of ['local', 'dev']) {
    const { calls, error, target } = await runAuthSetup(environment, {
      ok: true,
      json: async () => matchingProof,
    });
    assert.equal(error.message, 'stopped before browser launch');
    assert.equal(calls[0][0], 'preflight');
    assert.equal(calls[0][1], target);
    if (environment === 'local') {
      assert.equal(calls[1][1], 'http://localhost:5179/__e2e/proxy-target');
      assert.equal(calls[1][2].credentials, 'omit');
    }
    assert.deepEqual(
      calls.map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
      environment === 'local'
        ? ['preflight', 'fetch', 'credentials', 'credentials', 'mkdir', 'cleanup', 'launch']
        : ['preflight', 'credentials', 'credentials', 'mkdir', 'cleanup', 'launch']
    );
  }
});
