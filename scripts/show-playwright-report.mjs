import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment } from '../utils/environment.mjs';
import { getEnvironmentPaths } from '../utils/environment-paths.mjs';
import { parseRunnerArgs } from './runner-args.mjs';

const { environment: selectedEnvironment, args } = parseRunnerArgs(
  process.argv.slice(2),
  process.env.E2E_ENV || 'local'
);
const isLastRun = args.includes('--last');
if (args.length !== Number(isLastRun)) {
  throw new Error('[e2e] Report accepts only --env <environment> and optional --last.');
}

const environment = resolveEnvironment(selectedEnvironment);
const paths = getEnvironmentPaths(environment);
const e2eDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.resolve(
  e2eDirectory,
  isLastRun ? paths.backupDir : paths.htmlReportDir
);
const playwrightCliPath = fileURLToPath(
  new URL('../node_modules/playwright/cli.js', import.meta.url)
);
const result = spawnSync(process.execPath, [playwrightCliPath, 'show-report', reportDirectory], {
  env: { ...process.env, E2E_ENV: environment },
  shell: false,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
