import type { ResolvedE2EConfig } from './environment.mjs';

export function assertLocalProxyTarget(
  config: Pick<ResolvedE2EConfig, 'environment' | 'baseUrl' | 'apiUrl' | 'apiRoot'>,
  fetchImpl?: typeof fetch
): Promise<void>;
