export interface EnvironmentPaths {
  authDir: string;
  authStateFile(index: number): string;
  outputDir: string;
  jsonResultsFile: string;
  htmlReportDir: string;
  backupDir: string;
  postmanCookieFile: string;
}

export function getEnvironmentPaths(environment: string): EnvironmentPaths;
export function scopeArtifactPath(environment: string, requestedPath: string): string;
export function scopePlaywrightOutputArgs(args: string[], environment: string): string[];
export function clearEnvironmentAuthState(
  environment: string,
  e2eRoot: string,
  fileSystem?: {
    existsSync(path: string): boolean;
    readdirSync(path: string): string[];
    rmSync(path: string, options: { force: true }): void;
  }
): void;
