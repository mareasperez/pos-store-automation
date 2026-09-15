export type E2EEnvironment = 'dev' | 'local' | 'qa' | 'staging' | 'prod';

export interface ResolvedE2EConfig {
  environment: E2EEnvironment;
  env: Record<string, string | undefined>;
  baseUrl: string;
  apiUrl: string;
  apiRoot: string;
  credentials: { username: string; password: string };
  tenantId: string;
}

export function resolveEnvironment(value?: string): E2EEnvironment;
export function loadEnvironment(value?: string): Record<string, string | undefined>;
export function resolveE2EConfig(value?: string): ResolvedE2EConfig;
