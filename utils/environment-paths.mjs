import fs from 'node:fs';
import path from 'node:path';
import { resolveEnvironment } from './environment.mjs';

const environments = ['local', 'dev', 'qa', 'staging', 'prod'];

export function getEnvironmentPaths(value) {
  const environment = resolveEnvironment(value);
  const authDir = path.posix.join('playwright', '.auth', environment);
  const outputDir = path.posix.join('test-results', environment);
  const htmlReportDir = path.posix.join('playwright-report', environment);
  const backupDir = path.posix.join('playwright-report-backup', `${environment}-lastrun`);

  return {
    authDir,
    authStateFile(index) {
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new Error('Authentication state index must be a non-negative integer.');
      }
      return path.posix.join(authDir, `user-${index}.json`);
    },
    outputDir,
    jsonResultsFile: path.posix.join(outputDir, 'results.json'),
    htmlReportDir,
    backupDir,
    postmanCookieFile: path.posix.join('..', 'postman', `.auth-cookies-${environment}.json`),
  };
}

export function scopeArtifactPath(value, requestedPath) {
  const environment = resolveEnvironment(value);
  const outputRoot = path.posix.join('test-results', environment);
  const normalized = requestedPath.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(requestedPath)) {
    throw new Error('Playwright output paths must be relative to the selected environment.');
  }

  let relative = normalized;
  if (relative === 'test-results') {
    relative = 'results';
  } else if (relative.startsWith('test-results/')) {
    relative = relative.slice('test-results/'.length);
    const [pathEnvironment, ...remaining] = relative.split('/');
    if (environments.includes(pathEnvironment)) {
      if (pathEnvironment !== environment) {
        throw new Error('Playwright output paths must stay inside the selected environment.');
      }
      relative = remaining.join('/');
    }
  }

  const resolvedRoot = path.posix.resolve('/', outputRoot);
  const resolvedPath = path.posix.resolve(resolvedRoot, relative);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw new Error('Playwright output paths must stay inside the selected environment.');
  }
  return path.posix.relative('/', resolvedPath);
}

export function scopePlaywrightOutputArgs(args, environment) {
  const scopedArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') {
      const outputPath = args[index + 1];
      if (!outputPath || outputPath.startsWith('-')) {
        throw new Error('[e2e] --output requires a relative path.');
      }
      scopedArgs.push(argument, scopeArtifactPath(environment, outputPath));
      index += 1;
    } else if (argument.startsWith('--output=')) {
      scopedArgs.push(`--output=${scopeArtifactPath(environment, argument.slice(9))}`);
    } else {
      scopedArgs.push(argument);
    }
  }
  return scopedArgs;
}

export function clearEnvironmentAuthState(value, e2eRoot, fileSystem = fs) {
  const authDirectory = path.resolve(e2eRoot, getEnvironmentPaths(value).authDir);
  if (!fileSystem.existsSync(authDirectory)) return;

  for (const file of fileSystem.readdirSync(authDirectory)) {
    if (/^user(?:-\d+)?\.json$/.test(file)) {
      fileSystem.rmSync(path.join(authDirectory, file), { force: true });
    }
  }
}
