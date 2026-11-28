import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import ts from 'typescript';
import { getEnvironmentPaths } from '../utils/environment-paths.mjs';
import * as targetPolicy from '../utils/target-policy.mjs';

const helper = fileURLToPath(
  new URL('../tests/fractional/fractional-real.helpers.ts', import.meta.url)
);
const source = fs
  .readFileSync(helper, 'utf8')
  .replaceAll(
    'import.meta.url',
    JSON.stringify(new URL('../tests/fractional/fractional-real.helpers.ts', import.meta.url).href)
  );
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const root = path.resolve(path.dirname(helper), '..', '..');

function loadHelper(environment) {
  const authDir = path.resolve(root, getEnvironmentPaths(environment).authDir);
  const reads = [];
  const config = { environment, baseUrl: 'http://localhost:5173', tenantId: 'tenant-dummy' };
  const modules = {
    'node:fs': {
      readdirSync(directory) {
        reads.push(directory);
        assert.equal(directory, authDir, 'must list only the selected environment');
        return ['user-0.json', 'user-1.json', 'user-2.json'];
      },
      readFileSync(file) {
        reads.push(file);
        assert.equal(path.dirname(file), authDir, 'must read only selected environment sessions');
        const index = Number(path.basename(file).match(/\d+/)[0]);
        return JSON.stringify({
          origins: [
            {
              origin: config.baseUrl,
              localStorage: [
                {
                  name: 'pos_app_store',
                  value: JSON.stringify({
                    state: { activeTenantId: config.tenantId, user: { id: index + 1 } },
                  }),
                },
              ],
            },
          ],
        });
      },
    },
    'node:path': path,
    'node:url': { fileURLToPath },
    '@fixtures': { expect },
    '@config': { config },
    '../../support/flows/target.flow': {},
    '../../utils/target-policy.mjs': targetPolicy,
    '../../utils/environment-paths.mjs': { getEnvironmentPaths },
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
    },
    { filename: helper }
  );
  return { exports, authDir, reads };
}

test('fractional actor validation reads only the selected local or dev dummy sessions', () => {
  for (const environment of ['local', 'dev']) {
    const { exports, authDir, reads } = loadHelper(environment);
    exports.assertThreeDistinctConfiguredActors(path.join(authDir, 'user-0.json'));
    assert.deepEqual(reads, [
      authDir,
      ...[0, 1, 2].map((index) => path.join(authDir, `user-${index}.json`)),
    ]);
  }
});
