import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, resolveEnvironment } from '../utils/environment.mjs';

const rawArgs = process.argv.slice(2);
const environmentFlagIndex = rawArgs.indexOf('--env');
const inlineEnvironment = rawArgs.find((argument) => argument.startsWith('--env='));

let environment;
let args;
if (environmentFlagIndex >= 0) {
  environment = rawArgs[environmentFlagIndex + 1];
  args = [
    ...rawArgs.slice(0, environmentFlagIndex),
    ...rawArgs.slice(environmentFlagIndex + 2),
  ];
} else if (inlineEnvironment) {
  environment = inlineEnvironment.slice('--env='.length);
  args = rawArgs.filter((argument) => argument !== inlineEnvironment);
} else if (rawArgs[0]?.startsWith('--')) {
  environment = process.env.E2E_ENV || 'local';
  args = rawArgs;
} else {
  [environment, ...args] = rawArgs;
}

if (!environment) {
  console.error('Usage: node ./scripts/run-playwright-env.mjs [--env <env>] [playwright args...]');
  process.exit(1);
}

const resolvedEnvironment = resolveEnvironment(environment);
const runtimeEnv = loadEnvironment(resolvedEnvironment);

if (environment === 'prod' && runtimeEnv.E2E_ALLOW_PROD !== 'true') {
  console.error(
    '[e2e] Production runs are blocked by default. Set E2E_ALLOW_PROD=true for the approved sandbox tenant.'
  );
  process.exit(1);
}

if (environment === 'prod') {
  const configuredTenant = runtimeEnv.TEST_TENANT_ID || runtimeEnv.E2E_TENANT_ID;
  const approvedTenant = runtimeEnv.E2E_PROD_TEST_TENANT_ID;
  if (!approvedTenant || configuredTenant !== approvedTenant) {
    console.error(
      '[e2e] Production runs require TEST_TENANT_ID/E2E_TENANT_ID to equal E2E_PROD_TEST_TENANT_ID.'
    );
    process.exit(1);
  }
}

const playwrightCliPath = fileURLToPath(
  new URL('../node_modules/playwright/cli.js', import.meta.url)
);

const result = spawnSync(process.execPath, [playwrightCliPath, 'test', ...args], {
  env: runtimeEnv,
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
