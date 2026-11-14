import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEnvironment } from '../utils/environment.mjs';
import { parseRunnerArgs } from './runner-args.mjs';

test('runner defaults to local when invoked without arguments', () => {
  assert.deepEqual(parseRunnerArgs([], 'local'), { environment: 'local', args: [] });
});

test('runner selects explicit environments and preserves Playwright arguments', () => {
  assert.deepEqual(parseRunnerArgs(['--env', 'dev', '--list'], 'local'), {
    environment: 'dev',
    args: ['--list'],
  });
  assert.deepEqual(parseRunnerArgs(['--env=prod', 'tests/smoke/api.spec.ts'], 'local'), {
    environment: 'prod',
    args: ['tests/smoke/api.spec.ts'],
  });
});

test('runner preserves legacy positional environment syntax', () => {
  assert.deepEqual(parseRunnerArgs(['dev', '--list'], 'local'), {
    environment: 'dev',
    args: ['--list'],
  });
});

test('runner rejects missing or conflicting environment options', () => {
  assert.throws(() => parseRunnerArgs(['--env'], 'local'), /--env requires a value/);
  assert.throws(() => parseRunnerArgs(['--env='], 'local'), /--env requires a value/);
  assert.throws(
    () => parseRunnerArgs(['--env', 'dev', '--env=prod'], 'local'),
    /specify the environment once/i
  );
  assert.throws(
    () => parseRunnerArgs(['dev', '--env', 'prod'], 'local'),
    /specify the environment once/i
  );
  const invalid = parseRunnerArgs(['--env', 'unknown'], 'local');
  assert.throws(() => resolveEnvironment(invalid.environment), /Unsupported E2E_ENV/);
});
