import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  clearEnvironmentAuthState,
  getEnvironmentPaths,
  scopeArtifactPath,
  scopePlaywrightOutputArgs,
} from '../utils/environment-paths.mjs';

const environments = ['local', 'dev', 'qa', 'staging', 'prod'];

test('authentication and generated artifacts are isolated by selected environment', () => {
  const paths = environments.map((environment) => getEnvironmentPaths(environment));
  const uniquePaths = (selector) => new Set(paths.map((entry) => selector(entry)));

  for (const field of ['authDir', 'outputDir', 'htmlReportDir', 'backupDir', 'postmanCookieFile']) {
    assert.equal(uniquePaths((entry) => entry[field]).size, environments.length, field);
  }
  assert.equal(
    paths.some((entry) => entry.authDir === 'playwright/.auth'),
    false
  );
});

test('environment selection chooses only its own auth slots without using legacy root sessions', () => {
  const qa = getEnvironmentPaths('qa');

  assert.equal(qa.authStateFile(0), 'playwright/.auth/qa/user-0.json');
  assert.equal(qa.authStateFile(2), 'playwright/.auth/qa/user-2.json');
  assert.notEqual(qa.authStateFile(0), 'playwright/.auth/user.json');
  assert.notEqual(qa.authStateFile(0), 'playwright/.auth/user-0.json');
});

test('custom output paths remain inside the selected environment results directory', () => {
  assert.equal(
    scopeArtifactPath('local', 'test-results/fractional/run.json'),
    'test-results/local/fractional/run.json'
  );
  assert.equal(
    scopeArtifactPath('qa', 'test-results\\readiness-isolated'),
    'test-results/qa/readiness-isolated'
  );
  assert.throws(() => scopeArtifactPath('qa', '../../shared/results.json'), /stay inside/i);
  assert.throws(() => scopeArtifactPath('qa', 'D:\\shared\\results.json'), /relative/i);
  assert.throws(
    () => scopeArtifactPath('qa', 'test-results/local/results.json'),
    /selected environment/i
  );
  assert.deepEqual(scopePlaywrightOutputArgs(['--list', '--output', 'test-results/manual'], 'qa'), [
    '--list',
    '--output',
    'test-results/qa/manual',
  ]);
  assert.deepEqual(scopePlaywrightOutputArgs(['--output=test-results/manual'], 'qa'), [
    '--output=test-results/qa/manual',
  ]);
});

test('auth setup cleanup removes files only from the selected environment folder', () => {
  const removed = [];
  const root = 'D:\\workspace\\e2e';
  clearEnvironmentAuthState('qa', root, {
    existsSync: () => true,
    readdirSync: () => ['user.json', 'user-0.json', 'notes.txt'],
    rmSync: (file) => removed.push(file),
  });

  assert.deepEqual(removed, [
    path.join(root, 'playwright', '.auth', 'qa', 'user.json'),
    path.join(root, 'playwright', '.auth', 'qa', 'user-0.json'),
  ]);
});
