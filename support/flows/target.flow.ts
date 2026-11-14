import type { Page, Request } from '@playwright/test';
import { expect } from '@fixtures';
import { config } from '@config';
import {
  isAllowedTargetRequest,
  isAuthenticationMutation,
  isConfiguredApiRequest,
  isConfiguredFrontendOrigin,
  matchesConfiguredTenant,
} from '../../utils/target-policy.mjs';

interface TargetPreflightOptions {
  requiredPermissions?: readonly string[];
  checkEmptyCart?: boolean;
  verifyBrowserTarget?: boolean;
}

interface SavedAppState {
  state?: {
    activeTenantId?: string;
    tenants?: { id: string }[];
    user?: { permissions?: string[] };
  };
}

interface SavedCartState {
  state?: {
    lines?: unknown[];
    savedDrafts?: unknown[];
    manualDiscountAmountInput?: string;
    manualDiscountReason?: string;
  };
}

function formatDestination(destination: string): string {
  try {
    const url = new URL(destination, config.baseUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<invalid URL>';
  }
}

function isReadOnlyFrontendFetch(request: Request): boolean {
  const url = new URL(request.url());
  if (request.method() !== 'GET' || !isConfiguredFrontendOrigin(url.origin, config.baseUrl)) {
    return false;
  }
  const { pathname } = url;
  return (
    pathname === '/config' || pathname.startsWith('/config/') || pathname.startsWith('/locales/')
  );
}

function hasApplicationApiIdentity(request: Request): boolean {
  const headers = request.headers();
  return (
    headers['x-tenant-id'] === config.tenantId ||
    /^Bearer\s+\S+$/i.test(headers.authorization ?? '') ||
    /(?:^|;\s*)access_token=/i.test(headers.cookie ?? '')
  );
}

function isBrowserApiRequest(request: Request): boolean {
  if (!['fetch', 'xhr'].includes(request.resourceType()) || isReadOnlyFrontendFetch(request)) {
    return false;
  }
  const url = new URL(request.url());
  return (
    hasApplicationApiIdentity(request) ||
    isConfiguredApiRequest(request.url(), config) ||
    (url.origin === new URL(config.apiRoot).origin &&
      !isConfiguredFrontendOrigin(url.origin, config.baseUrl))
  );
}

function getTargetProbeUrl(): string {
  const url = new URL(config.baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/catalog/products`;
  url.searchParams.set('lng', 'es');
  return url.toString();
}

export async function assertConfiguredTarget(
  page: Page,
  {
    requiredPermissions = [],
    checkEmptyCart = true,
    verifyBrowserTarget = true,
  }: TargetPreflightOptions = {}
): Promise<() => void> {
  expect(config.tenantId, 'An explicit target tenant is required').toBeTruthy();
  const saved = await page.context().storageState();
  const storage = saved.origins.find((origin) =>
    isConfiguredFrontendOrigin(origin.origin, config.baseUrl)
  )?.localStorage;
  const app = JSON.parse(
    storage?.find((item) => item.name === 'pos_app_store')?.value ?? '{}'
  ) as SavedAppState;

  expect(
    matchesConfiguredTenant(app.state?.activeTenantId, config.tenantId),
    'Saved active tenant must match the configured tenant'
  ).toBe(true);
  expect(
    (app.state?.tenants ?? []).some((tenant) =>
      matchesConfiguredTenant(tenant.id, config.tenantId)
    ),
    'Saved session must include the configured tenant'
  ).toBe(true);
  expect(app.state?.user?.permissions ?? []).toEqual(
    expect.arrayContaining([...requiredPermissions])
  );

  if (checkEmptyCart) {
    const cart = JSON.parse(
      storage?.find((item) => item.name === 'pos_cart_storage')?.value ?? '{}'
    ) as SavedCartState;
    expect(cart.state?.lines ?? [], 'Never alter a saved user cart').toHaveLength(0);
    expect(cart.state?.savedDrafts ?? [], 'Never alter saved user drafts').toHaveLength(0);
    expect(cart.state?.manualDiscountAmountInput ?? '', 'Saved discount amount must be clear').toBe(
      ''
    );
    expect(cart.state?.manualDiscountReason ?? '', 'Saved discount reason must be clear').toBe('');
  }

  let blockedAuthenticationRequests = 0;
  const unexpectedApiDestinations = new Set<string>();
  const blockedProbeWrites = new Set<string>();

  if (verifyBrowserTarget) {
    let probeActive = true;
    let signalProbeEvent!: () => void;
    let signalObservedApi!: () => void;
    const probeEvent = new Promise<void>((resolve) => {
      signalProbeEvent = resolve;
    });
    const observedApi = new Promise<void>((resolve) => {
      signalObservedApi = resolve;
    });

    await page.context().route('**/*', async (route) => {
      const request = route.request();
      const destination = formatDestination(request.url());
      const method = request.method();
      const apiRequest = isBrowserApiRequest(request);

      if (isAuthenticationMutation(request.url(), method)) {
        blockedAuthenticationRequests += 1;
        if (probeActive) signalProbeEvent();
        await route.abort('blockedbyclient');
        return;
      }

      if (apiRequest && !isConfiguredApiRequest(request.url(), config)) {
        if (unexpectedApiDestinations.size < 3) {
          unexpectedApiDestinations.add(destination);
        }
        if (probeActive) signalProbeEvent();
        await route.abort('blockedbyclient');
        return;
      }

      if (probeActive && apiRequest && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        if (blockedProbeWrites.size < 3) {
          blockedProbeWrites.add(`${method} ${destination}`);
        }
        signalProbeEvent();
        await route.abort('blockedbyclient');
        return;
      }

      if (
        !isConfiguredApiRequest(request.url(), config) &&
        !isAllowedTargetRequest(request.url(), method, config, config.apiRoot)
      ) {
        await route.abort('blockedbyclient');
        return;
      }

      if (probeActive && apiRequest && ['GET', 'HEAD'].includes(method)) {
        signalObservedApi();
      }
      await route.fallback();
    });

    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
    let navigationError: unknown;
    const navigation = page
      .goto(getTargetProbeUrl(), { waitUntil: 'domcontentloaded', timeout: 10_000 })
      .then(
        () => 'loaded' as const,
        (error: unknown) => {
          navigationError = error;
          return 'navigation-error' as const;
        }
      );
    const timeout = new Promise<'timeout'>((resolve) => {
      timer.id = setTimeout(() => resolve('timeout'), 5_000);
    });
    let probeResult = await Promise.race([
      navigation,
      probeEvent.then(() => 'request' as const),
      observedApi.then(() => 'api' as const),
      timeout,
    ]);
    if (probeResult === 'loaded') {
      probeResult = await Promise.race([
        probeEvent.then(() => 'request' as const),
        observedApi.then(() => 'api' as const),
        timeout,
      ]);
    }
    await navigation;
    if (timer.id) clearTimeout(timer.id);

    if (unexpectedApiDestinations.size > 0) {
      throw new Error(
        `[e2e] Effective browser API target mismatch: expected ${formatDestination(config.apiRoot)}; ` +
          `observed ${[...unexpectedApiDestinations].join(', ')}.`
      );
    }
    if (blockedAuthenticationRequests > 0) {
      throw new Error(
        `[e2e] Read-only target probe blocked ${blockedAuthenticationRequests} login, refresh, or session request(s).`
      );
    }
    if (blockedProbeWrites.size > 0) {
      throw new Error(
        `[e2e] Read-only target probe blocked mutation(s): ${[...blockedProbeWrites].join(', ')}.`
      );
    }
    if (navigationError) {
      throw new Error(
        '[e2e] Read-only frontend navigation did not complete during the target probe.'
      );
    }
    if (probeResult !== 'api') {
      throw new Error(
        `[e2e] No effective browser API request reached ${formatDestination(config.apiRoot)} ` +
          'within 5000ms during the read-only target probe.'
      );
    }
    probeActive = false;
  }

  return () => {
    expect(blockedAuthenticationRequests, 'No login, refresh, or session creation').toBe(0);
    expect(unexpectedApiDestinations, 'Only the configured browser API target is allowed').toEqual(
      new Set()
    );
  };
}
