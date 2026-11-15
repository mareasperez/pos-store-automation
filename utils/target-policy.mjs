function getUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

export function isConfiguredFrontendOrigin(savedOrigin, baseUrl) {
  const configuredUrl = getUrl(baseUrl);
  return Boolean(configuredUrl && savedOrigin === configuredUrl.origin);
}

function isLocalApiAlias(config, configuredUrl, runtimeUrl) {
  if (config.environment !== 'local') return false;
  if (configuredUrl.protocol !== 'http:' || runtimeUrl.protocol !== 'http:') return false;

  const hosts = new Set([configuredUrl.hostname, runtimeUrl.hostname]);
  return (
    hosts.size === 2 &&
    hosts.has('localhost') &&
    hosts.has('127.0.0.1') &&
    configuredUrl.port === runtimeUrl.port
  );
}

function hasEquivalentApiPath(configuredUrl, runtimeUrl) {
  const configuredPath = configuredUrl.pathname.replace(/\/+$/, '') || '/';
  const runtimePath = runtimeUrl.pathname.replace(/\/+$/, '') || '/';
  if (configuredPath === runtimePath) return true;
  return (
    (configuredPath === '/' && runtimePath === '/api') ||
    (configuredPath === '/api' && runtimePath === '/')
  );
}

function isWithinApiPrefix(requestUrl, apiUrl) {
  const prefix = apiUrl.pathname.replace(/\/+$/, '') || '/';
  const requestPath = requestUrl.pathname.replace(/\/+$/, '') || '/';
  return prefix === '/' || requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

export function isRuntimeApiTarget(runtimeApiUrl, config) {
  const configuredUrl = getUrl(config.apiUrl, config.baseUrl);
  const runtimeUrl = getUrl(runtimeApiUrl, config.baseUrl);
  if (!configuredUrl || !runtimeUrl) return false;
  return (
    (runtimeUrl.origin === configuredUrl.origin ||
      isLocalApiAlias(config, configuredUrl, runtimeUrl)) &&
    hasEquivalentApiPath(configuredUrl, runtimeUrl)
  );
}

export function isConfiguredApiRequest(requestUrl, config) {
  const configuredUrl = getUrl(config.apiRoot || config.apiUrl, config.baseUrl);
  const request = getUrl(requestUrl, config.baseUrl);
  if (!configuredUrl || !request) return false;
  return (
    (request.origin === configuredUrl.origin || isLocalApiAlias(config, configuredUrl, request)) &&
    isWithinApiPrefix(request, configuredUrl)
  );
}

export function matchesConfiguredTenant(savedTenantId, configuredTenantId) {
  return Boolean(configuredTenantId && savedTenantId === configuredTenantId);
}

export function hasDistinctActorIds(actorIds, expectedCount) {
  return actorIds.length === expectedCount && new Set(actorIds).size === expectedCount;
}

export function selectWorkerAuthState(stateFiles, workerInfo) {
  const workers = workerInfo.config?.workers;
  if (workers > stateFiles.length) {
    throw new Error(
      `[auth] ${workers} workers require at least ${workers} cashier sessions; found ${stateFiles.length}. ` +
        'Reduce --workers or prepare more distinct cashier sessions.'
    );
  }

  const stateFile = stateFiles[workerInfo.parallelIndex];
  if (!stateFile) {
    throw new Error(
      `[auth] No dedicated cashier session for parallel slot ${workerInfo.parallelIndex}.`
    );
  }
  return stateFile;
}

export function assertDistinctCashierSessions(savedStates, baseUrl) {
  if (!savedStates.length) {
    throw new Error('[auth] At least one saved cashier session is required.');
  }

  const actorIds = savedStates.map((saved, index) => {
    const origin = Array.isArray(saved?.origins)
      ? saved.origins.find((item) => isConfiguredFrontendOrigin(item?.origin, baseUrl))
      : undefined;
    const storage = Array.isArray(origin?.localStorage)
      ? origin.localStorage.find((item) => item?.name === 'pos_app_store')
      : undefined;
    if (typeof storage?.value !== 'string') {
      throw new Error(
        `[auth] Worker session ${index} needs pos_app_store for the configured frontend.`
      );
    }

    const app = JSON.parse(storage.value);
    const rawActorId = app?.state?.user?.id;
    const actorId = Number(rawActorId);
    if (
      !['number', 'string'].includes(typeof rawActorId) ||
      !Number.isSafeInteger(actorId) ||
      actorId <= 0
    ) {
      throw new Error(`[auth] Worker session ${index} needs a valid cashier ID.`);
    }
    return actorId;
  });

  if (!hasDistinctActorIds(actorIds, savedStates.length)) {
    throw new Error(
      '[auth] Worker sessions must belong to distinct cashiers; different files cannot share a cashier.'
    );
  }
}

export function getAllowedTargetOrigins(config, runtimeApiUrl) {
  const baseUrl = getUrl(config.baseUrl);
  const configuredApiUrl = getUrl(config.apiUrl, config.baseUrl);
  const runtimeUrl = getUrl(runtimeApiUrl, config.baseUrl);
  if (!baseUrl || !configuredApiUrl || !runtimeUrl || !isRuntimeApiTarget(runtimeApiUrl, config)) {
    throw new Error('The frontend runtime API does not match the configured API target.');
  }

  return new Set([baseUrl.origin, configuredApiUrl.origin, runtimeUrl.origin]);
}

export function isAuthenticationMutation(url, method) {
  const parsed = getUrl(url);
  if (!parsed) return true;
  if (/(?:^|\/)(?:auth\/)?(?:login|refresh)(?:\/|$)/i.test(parsed.pathname)) return true;
  return method.toUpperCase() === 'POST' && /(?:^|\/)sessions?(?:\/|$)/i.test(parsed.pathname);
}

export function isAllowedTargetRequest(requestUrl, method, config, runtimeApiUrl) {
  const parsed = getUrl(requestUrl);
  if (!parsed || isAuthenticationMutation(requestUrl, method)) return false;
  return getAllowedTargetOrigins(config, runtimeApiUrl).has(parsed.origin);
}
