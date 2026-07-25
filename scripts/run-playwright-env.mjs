import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [, , environment, ...args] = process.argv;

if (!environment) {
  console.error('Usage: node ./scripts/run-playwright-env.mjs <env> [playwright args...]');
  process.exit(1);
}

const playwrightCliPath = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));

const result = spawnSync(process.execPath, [playwrightCliPath, 'test', ...args], {
  env: { ...process.env, E2E_ENV: environment },
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
