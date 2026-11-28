import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment } from '../utils/environment.mjs';
import { getEnvironmentPaths } from '../utils/environment-paths.mjs';
import { parseRunnerArgs } from './runner-args.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const e2eDirectory = path.resolve(scriptsDirectory, '..');
const { environment: selectedEnvironment, args } = parseRunnerArgs(
  process.argv.slice(2),
  process.env.E2E_ENV || 'local'
);
if (args.length) throw new Error('[e2e] Save-state accepts only the environment selector.');
const environment = resolveEnvironment(selectedEnvironment);
const environmentPaths = getEnvironmentPaths(environment);
const reportDirectory = path.resolve(e2eDirectory, environmentPaths.htmlReportDir);
const testResultsDirectory = path.resolve(e2eDirectory, environmentPaths.outputDir);
const backupDirectory = path.resolve(e2eDirectory, environmentPaths.backupDir);
const backupTestResultsDirectory = path.join(backupDirectory, 'test-results');

await rm(backupDirectory, { recursive: true, force: true });
await mkdir(backupDirectory, { recursive: true });
await cp(reportDirectory, backupDirectory, { recursive: true, force: true });

try {
  await cp(testResultsDirectory, backupTestResultsDirectory, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

console.log(`Playwright state saved to ${environmentPaths.backupDir}`);
