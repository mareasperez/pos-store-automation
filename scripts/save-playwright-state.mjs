import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const e2eDirectory = path.resolve(scriptsDirectory, '..');
const reportDirectory = path.join(e2eDirectory, 'playwright-report');
const testResultsDirectory = path.join(e2eDirectory, 'test-results');
const jsonResultsFile = path.join(e2eDirectory, 'test-results.json');
const backupDirectory = path.join(e2eDirectory, 'playwright-report-backup-lastrun');
const backupTestResultsDirectory = path.join(backupDirectory, 'test-results');
const backupJsonResultsFile = path.join(backupDirectory, 'test-results.json');

await rm(backupDirectory, { recursive: true, force: true });
await mkdir(backupDirectory, { recursive: true });
await cp(reportDirectory, backupDirectory, { recursive: true, force: true });

try {
  await cp(testResultsDirectory, backupTestResultsDirectory, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

try {
  await cp(jsonResultsFile, backupJsonResultsFile, { force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

console.log('Playwright state saved to playwright-report-backup-lastrun');
