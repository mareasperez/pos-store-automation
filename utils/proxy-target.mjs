function normalizedPath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function isLoopbackAlias(expectedHost, actualHost) {
  const hosts = new Set([expectedHost, actualHost]);
  return hosts.size === 2 && hosts.has('localhost') && hosts.has('127.0.0.1');
}

export function matchesLocalProxyTarget(proof, apiUrl) {
  const target = proof?.target;
  if (
    proof?.proxyContext !== '/api' ||
    proof?.hasRewrite !== false ||
    !target ||
    target.hasCredentials !== false ||
    target.hasQuery !== false ||
    target.hasHash !== false ||
    target.protocol !== 'http:' ||
    typeof target.pathname !== 'string'
  ) {
    return false;
  }

  let configuredApi;
  try {
    configuredApi = new URL(apiUrl);
  } catch {
    return false;
  }

  if (
    configuredApi.protocol !== 'http:' ||
    !configuredApi.pathname.startsWith('/') ||
    !isLoopbackHost(configuredApi.hostname) ||
    typeof target.hostname !== 'string' ||
    !isLoopbackHost(target.hostname) ||
    typeof target.port !== 'string' ||
    !target.pathname.startsWith('/')
  ) {
    return false;
  }

  const targetPath = normalizedPath(target.pathname);
  const proxyPath = normalizedPath(proof.proxyContext);
  const effectiveApiPath = targetPath === '/' ? proxyPath : `${targetPath}${proxyPath}`;
  const sameHost =
    target.hostname === configuredApi.hostname ||
    isLoopbackAlias(configuredApi.hostname, target.hostname);
  return (
    sameHost &&
    target.port === configuredApi.port &&
    effectiveApiPath === normalizedPath(configuredApi.pathname)
  );
}

export async function assertLocalProxyTarget(config, fetchImpl = globalThis.fetch) {
  if (config.environment !== 'local') return;

  const endpoint = new URL('/__e2e/proxy-target', config.baseUrl).toString();
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error(
      '[e2e] Unable to verify the local Vite API proxy target before browser traffic.'
    );
  }

  let proof;
  try {
    if (!response?.ok) throw new Error('unavailable');
    proof = await response.json();
  } catch {
    throw new Error('[e2e] Local Vite API proxy target proof is missing or malformed.');
  }

  if (!matchesLocalProxyTarget(proof, config.apiRoot || config.apiUrl)) {
    throw new Error('[e2e] Local Vite API proxy target does not match the configured local API.');
  }
}
