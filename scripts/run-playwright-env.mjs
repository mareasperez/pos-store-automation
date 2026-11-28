import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveE2EConfig, resolveEnvironment } from '../utils/environment.mjs';
import {
  getEnvironmentPaths,
  scopeArtifactPath,
  scopePlaywrightOutputArgs,
} from '../utils/environment-paths.mjs';
import { assertProductionRunAllowed } from './production-policy.mjs';
import { parseRunnerArgs } from './runner-args.mjs';

const rawArgs = process.argv.slice(2);
const { environment, args } = parseRunnerArgs(rawArgs, process.env.E2E_ENV || 'local');

const resolvedEnvironment = resolveEnvironment(environment);
const target = resolveE2EConfig(resolvedEnvironment);
const environmentPaths = getEnvironmentPaths(resolvedEnvironment);
const jsonOutputFile = scopeArtifactPath(
  resolvedEnvironment,
  target.env.PLAYWRIGHT_JSON_OUTPUT_FILE || environmentPaths.jsonResultsFile
);
const runtimeEnv = {
  ...target.env,
  E2E_ENV: resolvedEnvironment,
  BASE_URL: target.baseUrl,
  API_URL: target.apiUrl,
  ...(target.tenantId ? { TEST_TENANT_ID: target.tenantId } : {}),
  PLAYWRIGHT_HTML_OUTPUT_DIR: environmentPaths.htmlReportDir,
  PLAYWRIGHT_JSON_OUTPUT_FILE: jsonOutputFile,
};

if (resolvedEnvironment === 'prod') assertProductionRunAllowed(runtimeEnv, args);

const playwrightCliPath = fileURLToPath(
  new URL('../node_modules/playwright/cli.js', import.meta.url)
);

const result = spawnSync(
  process.execPath,
  [playwrightCliPath, 'test', ...scopePlaywrightOutputArgs(args, resolvedEnvironment)],
  {
    env: runtimeEnv,
    shell: false,
    stdio: 'inherit',
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
