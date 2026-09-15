import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvironment, resolveEnvironment } from '../utils/environment.mjs';

const [, , environment, ...args] = process.argv;

if (!environment) {
  console.error('Usage: node ./scripts/run-playwright-env.mjs <env> [playwright args...]');
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
