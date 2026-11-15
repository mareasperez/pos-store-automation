import type { ResolvedE2EConfig } from './environment.mjs';

export function isConfiguredFrontendOrigin(savedOrigin: string, baseUrl: string): boolean;
export function isRuntimeApiTarget(
  runtimeApiUrl: string,
  config: Pick<ResolvedE2EConfig, 'environment' | 'baseUrl' | 'apiUrl'>
): boolean;
export function isConfiguredApiRequest(
  requestUrl: string,
  config: Pick<ResolvedE2EConfig, 'environment' | 'baseUrl' | 'apiUrl'> & {
    apiRoot?: string;
  }
): boolean;
export function matchesConfiguredTenant(
  savedTenantId: string | undefined,
  configuredTenantId: string | undefined
): boolean;
export function hasDistinctActorIds(actorIds: number[], expectedCount: number): boolean;
export function selectWorkerAuthState(
  stateFiles: string[],
  workerInfo: { workerIndex: number; parallelIndex: number; config?: { workers: number } }
): string;
export function assertDistinctCashierSessions(savedStates: unknown[], baseUrl: string): void;
export function getAllowedTargetOrigins(
  config: Pick<ResolvedE2EConfig, 'environment' | 'baseUrl' | 'apiUrl'>,
  runtimeApiUrl: string
): Set<string>;
export function isAuthenticationMutation(url: string, method: string): boolean;
export function isAllowedTargetRequest(
  requestUrl: string,
  method: string,
  config: Pick<ResolvedE2EConfig, 'environment' | 'baseUrl' | 'apiUrl'>,
  runtimeApiUrl: string
): boolean;
