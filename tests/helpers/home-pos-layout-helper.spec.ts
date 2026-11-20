import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { startThemeTestServer } from './theme-test-server';

const repo = resolve(process.cwd(), '..');
const frontend = resolve(repo, 'frontend');
let server: { close: () => Promise<void>; resolvedUrls: { local: string[] } | null };
let origin: string;

type HomePosTestApi = {
  mountQuickActions: (visiblePermissions: string[]) => void;
  mountSidebar: () => void;
  mountAppSidebar: () => Promise<void>;
  mountSell: () => void;
  mountRankBadges: () => void;
  reset: () => void;
  setTheme: (themeFamily: string, themeMode: string) => void;
  allPermissions: string[];
  settingsPermission: string;
  themes: string[];
  sellFooterClass: string;
  sellGridClass: string;
};

declare global {
  interface Window {
    homePosTest?: HomePosTestApi;
  }
}

test.beforeAll(async () => {
  const tailwindUrl = pathToFileURL(
    resolve(frontend, 'node_modules/@tailwindcss/vite/dist/index.mjs')
  ).href;
  const { default: tailwindcss } = await import(tailwindUrl);
  server = await startThemeTestServer({
    root: frontend,
    configFile: false,
    envFile: false,
    plugins: [
      tailwindcss(),
      {
        name: 'home-pos-layout-fixture',
        resolveId(id: string) {
          return id === 'virtual:home-pos-layout' ? '\0home-pos-layout' : undefined;
        },
        load(id: string) {
          if (id !== '\0home-pos-layout') return undefined;
          return `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { MemoryRouter } from 'react-router-dom';
            import AuthContext from '/src/auth/UserContext.tsx';
            import { DashboardQuickActions } from '/src/features/catalog/screens/Dashboard/DashboardQuickActions.tsx';
            import { PERMISSIONS } from '/src/shared/constants/permissions.ts';
            import { themeCatalog } from '/src/features/admin/screens/SettingsPage/themeCatalog.ts';
            import { useTheme } from '/src/shared/hooks/useTheme.ts';
            import { DEFAULT_THEME_CUSTOM_CONFIG, useUIStore } from '/src/shared/stores/useUIStore.ts';
            import { SellPageFooter } from '/src/features/sales/screens/Sell/components/SellPageFooter.tsx';
            import { Sidebar, SidebarInset, SidebarProvider, SidebarRail, SidebarTrigger } from '/src/lib/components/ui/sidebar.tsx';
            import dashboardStyles from '/src/features/catalog/screens/Dashboard/dashboard-page.module.css';
            import sellStyles from '/src/features/sales/screens/Sell/sell-page.module.css';
            import ticketStyles from '/src/features/sales/components/TicketPreview/ticket-preview.module.css';
            import '/src/styles/base.css';
            import '/src/styles/themes.css';
            import '/src/shared/components/ui/cards/KPICard/kpi-card.css';
            import '/src/shared/components/ui/layout/MainLayout/main-layout.css';
            import '/src/index.css';

            const actions = [
              ['pos', 'Punto de venta', PERMISSIONS.SALES.CREATE, 'success'],
              ['customers', 'Clientes', PERMISSIONS.CUSTOMERS.VIEW, 'info'],
              ['stock', 'Inventario', PERMISSIONS.PRODUCTS.VIEW, 'warning'],
              ['reports', 'Reportes', PERMISSIONS.REPORTS.VIEW, 'purple'],
              ['stock-overview', 'Resumen de stock', PERMISSIONS.REPORTS.VIEW, 'info'],
              ['catalog', 'Catálogo', PERMISSIONS.PRODUCTS.VIEW, 'purple'],
              ['purchase', 'Nueva compra', PERMISSIONS.PURCHASES.CREATE, 'success'],
              ['suppliers', 'Proveedores', PERMISSIONS.SUPPLIERS.VIEW, 'warning'],
              ['sales-history', 'Historial de ventas', PERMISSIONS.SALES.VIEW, 'info'],
              ['receivables', 'Cuentas por cobrar', PERMISSIONS.RECEIVABLES.VIEW, 'warning'],
              ['shifts', 'Turnos', PERMISSIONS.SHIFTS.VIEW_ALL, 'primary'],
              ['settings', 'Configuración', PERMISSIONS.SETTINGS.GENERAL.VIEW, 'primary']
            ].map(([id, title, permission, tone]) => ({
              id,
              title,
              to: '/' + id,
              permission,
              tone,
              icon: React.createElement(
                'svg',
                { viewBox: '0 0 24 24', 'data-action-icon': true, 'aria-hidden': 'true' },
                React.createElement('path', {
                  d: 'M3 3h18v18H3z',
                  fill: 'none',
                  stroke: 'currentColor'
                })
              )
            }));

            let activeRoot;
            let activeHost;
            useUIStore.setState({ themeCustomConfig: DEFAULT_THEME_CUSTOM_CONFIG });
            function reset() {
              activeRoot?.unmount();
              activeHost?.remove();
              activeRoot = undefined;
              activeHost = undefined;
            }

            function authValue(visiblePermissions) {
              return {
                user: { username: 'layout-helper' },
                isAuthenticated: true,
                isLoading: false,
                hasRole: () => false,
                isAdmin: () => false,
                hasPermission: (permission) => visiblePermissions.includes(permission),
                hasAnyPermission: (permissions) => permissions.some((permission) => visiblePermissions.includes(permission)),
                hasAllPermissions: (permissions) => permissions.every((permission) => visiblePermissions.includes(permission)),
                tenants: [],
                currentTenantId: null,
                login: async () => false,
                logout: () => {},
                changeTenant: () => {},
                updateUser: () => {}
              };
            }

            function renderShell(content, { visiblePermissions = [], panelClass = 'layout-panel', globalFooter = true, sidebarContent = null } = {}) {
              reset();
              activeHost = document.createElement('div');
              activeHost.dataset.layoutFixture = 'true';
              document.body.appendChild(activeHost);
              activeRoot = createRoot(activeHost);
              activeRoot.render(
                React.createElement(MemoryRouter, null,
                  React.createElement(AuthContext.Provider, { value: authValue(visiblePermissions) },
                    React.createElement(SidebarProvider, { defaultOpen: false, className: 'layout-shell' },
                      React.createElement(Sidebar, { collapsible: 'icon', variant: 'floating', className: 'layout-sidebar' },
                        sidebarContent,
                        React.createElement(SidebarRail)
                      ),
                      React.createElement(SidebarInset, { className: 'layout-inset' },
                        React.createElement('header', { className: 'layout-header' },
                          React.createElement(SidebarTrigger, { 'aria-label': 'Toggle navigation' })
                        ),
                        React.createElement('main', { className: 'layout-main', 'data-layout-content': true },
                          React.createElement('div', { className: panelClass }, content)
                        ),
                        globalFooter
                          ? React.createElement('div', { className: 'layout-footer', 'data-global-footer': true }, 'Dashboard footer')
                          : null
                      )
                    )
                  )
                )
              );
            }

            function mountQuickActions(visiblePermissions) {
              const content = React.createElement(
                'div',
                { className: dashboardStyles['dashboard-page'] },
                React.createElement(DashboardQuickActions, { items: actions })
              );
              renderShell(content, { visiblePermissions });
            }

            function mountSidebar() {
              renderShell(React.createElement('div', { style: { minHeight: '40rem' } }, 'Content'));
            }

            async function mountAppSidebar() {
              await import('/src/i18n.ts');
              const [{ AppSidebar }, { TooltipProvider }] = await Promise.all([
                import('/src/shared/components/ui/layout/Sidebar/AppSidebar.tsx'),
                import('/src/lib/components/ui/tooltip.tsx')
              ]);
              renderShell(React.createElement('div', null, 'Content'), {
                sidebarContent: React.createElement(TooltipProvider, null, React.createElement(AppSidebar))
              });
            }

            function mountSell() {
              const rowNodes = Array.from({ length: 24 }, (_, index) =>
                React.createElement(
                  'div',
                  {
                    key: index,
                    className: ticketStyles['ticket-preview__line'],
                    'data-pos-line': index === 23 ? 'last' : undefined
                  },
                  React.createElement('span', { className: ticketStyles['ticket-preview__name'] }, 'Producto ' + (index + 1))
                )
              );
              const ticket = React.createElement(
                'div',
                { className: ticketStyles['ticket-preview'] },
                React.createElement('div', { className: ticketStyles['ticket-preview__body'], 'data-pos-ticket-body': true }, rowNodes)
              );
              const content = React.createElement(
                'div',
                { className: sellStyles['sell-page'] },
                React.createElement(
                  'div',
                  { className: sellStyles['sell-page__grid'] },
                  React.createElement('div', { className: sellStyles['sell-page__left'] }, ticket),
                  React.createElement('div', { className: sellStyles['sell-page__right'] },
                    React.createElement('div', { style: { minHeight: '12rem' } }, 'Checkout details')
                  )
                ),
                React.createElement(SellPageFooter, {
                  showStickyTotal: false,
                  manualDiscount: { hasEntry: false, isQuoteMode: false, payableTotal: 100 },
                  activeShift: { id: 1, status: 'OPEN' },
                  loadingShift: false,
                  canConfirm: true,
                  isPending: false,
                  onOpenShift: () => {},
                  onConfirmSale: () => {}
                })
              );
              renderShell(content, {
                panelClass: 'layout-panel layout-panel--sell',
                globalFooter: false
              });
            }

            function mountRankBadges() {
              reset();
              activeHost = document.createElement('div');
              activeHost.dataset.rankFixture = 'true';
              activeHost.style.backgroundColor = 'var(--color-surface)';
              activeHost.style.display = 'flex';
              activeHost.style.gap = '0.5rem';
              activeHost.style.padding = '1rem';
              document.body.appendChild(activeHost);
              for (const rank of [1, 2, 3]) {
                const badge = document.createElement('div');
                badge.className = dashboardStyles['dashboard-page__top-products-rank'];
                badge.dataset.rank = String(rank);
                badge.textContent = String(rank);
                activeHost.appendChild(badge);
              }
            }

            function setTheme(themeFamily, themeMode) {
              useUIStore.setState({ themeFamily, themeMode });
            }

            function Harness() {
              useTheme();
              return null;
            }

            window.homePosTest = {
              mountQuickActions,
              mountSidebar,
              mountAppSidebar,
              mountSell,
              mountRankBadges,
              reset,
              setTheme,
              allPermissions: [...new Set(actions.map((action) => action.permission))],
              settingsPermission: PERMISSIONS.SETTINGS.GENERAL.VIEW,
              themes: themeCatalog.map(({ id }) => id),
              sellFooterClass: sellStyles['sell-page__footer'],
              sellGridClass: sellStyles['sell-page__grid']
            };
            createRoot(document.getElementById('root')).render(React.createElement(Harness));
          `;
        },
      },
    ],
    resolve: {
      alias: [
        { find: '@components', replacement: resolve(frontend, 'src/shared/components') },
        { find: '@hooks', replacement: resolve(frontend, 'src/shared/hooks') },
        { find: '@stores', replacement: resolve(frontend, 'src/shared/stores') },
        { find: '@utils', replacement: resolve(frontend, 'src/shared/utils') },
        { find: '@services', replacement: resolve(frontend, 'src/shared/services') },
        { find: '@constants', replacement: resolve(frontend, 'src/shared/constants') },
        { find: '@styles', replacement: resolve(frontend, 'src/styles') },
        { find: '@types', replacement: resolve(frontend, 'src/shared/types') },
        { find: '@', replacement: resolve(frontend, 'src') },
      ],
    },
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'react-i18next',
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      fs: { allow: [repo] },
    },
    logLevel: 'error',
  });
  origin = server.resolvedUrls!.local[0].replace(/\/$/, '');
});

test.afterAll(async () => {
  await server?.close();
});

async function prepareFixture(page: import('@playwright/test').Page) {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()
  );
  await page.route(`${origin}/home-pos-layout-fixture`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/@id/__x00__home-pos-layout"></script></body></html>',
    })
  );
  await page.goto(`${origin}/home-pos-layout-fixture`);
  await page.waitForFunction(() => Boolean(window.homePosTest));
}

async function waitForLayout(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function waitForQuickActionTransitions(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    const cards = document.querySelectorAll<HTMLElement>('[data-quick-action] a > div');
    const animations = [...cards].flatMap((card) => card.getAnimations());
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

test('Home actions fit the requested viewports and keep semantic icon contrast', async ({
  page,
}) => {
  await prepareFixture(page);
  const permissions = await page.evaluate(() => window.homePosTest!.allPermissions);
  await page.evaluate((allowed) => window.homePosTest!.mountQuickActions(allowed), permissions);

  const lowContrast = new Map<
    string,
    {
      theme: string;
      viewport: string;
      tone: string;
      foreground: string;
      background: string;
      ratio: number;
      actions: number;
    }
  >();
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await waitForLayout(page);
    const measurements = await page.evaluate(() => {
      const actions = [...document.querySelectorAll<HTMLElement>('[data-quick-action]')];
      const cards = actions.map((action) => {
        const card = action.querySelector<HTMLElement>('a > div')!;
        const icon = action.querySelector<HTMLElement>('[data-quick-action-icon]')!;
        const title = action.querySelector<HTMLElement>('[data-quick-action-title]')!;
        const rect = card.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          iconHeight: iconRect.height,
          labelSize: Number.parseFloat(getComputedStyle(title).fontSize),
          tone: action.dataset.tone,
          foreground: getComputedStyle(icon).color,
          background: getComputedStyle(card).backgroundColor,
          id: action.dataset.quickAction,
          label: action.textContent?.trim(),
        };
      });
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        gridWidth: document.querySelector<HTMLElement>('[data-quick-actions]')!.clientWidth,
        gridScrollWidth: document.querySelector<HTMLElement>('[data-quick-actions]')!.scrollWidth,
        cards,
      };
    });

    expect(measurements.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(measurements.gridScrollWidth).toBeLessThanOrEqual(measurements.gridWidth);
    expect(measurements.cards).toHaveLength(12);
    expect(measurements.cards.map(({ tone }) => tone)).toEqual(
      expect.arrayContaining(['primary', 'success', 'warning', 'info', 'purple'])
    );
    const cardWidths = measurements.cards.map(({ width }) => width);
    expect(Math.max(...cardWidths) - Math.min(...cardWidths)).toBeLessThanOrEqual(1);
    expect(Math.min(...cardWidths)).toBeGreaterThanOrEqual(120);
    const settings = measurements.cards.find(({ id }) => id === 'settings');
    expect(settings?.width).toBeCloseTo(cardWidths[0], 0);
    expect(
      measurements.cards.every(({ iconHeight, labelSize }) => iconHeight >= labelSize * 1.5)
    ).toBe(true);

    for (const theme of ['default-light', 'default-dark']) {
      const [family, mode] = theme.split('-');
      await page.evaluate(({ family, mode }) => window.homePosTest!.setTheme(family, mode), {
        family,
        mode,
      });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await waitForQuickActionTransitions(page);
      const contrast = await page.evaluate(() => {
        const context = document.createElement('canvas').getContext('2d')!;
        const luminance = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .reduce((sum, channel, index) => {
              const color = channel / 255;
              return (
                sum +
                [0.2126, 0.7152, 0.0722][index] *
                  (color <= 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
        };
        return [...document.querySelectorAll<HTMLElement>('[data-quick-action]')].map((action) => {
          const icon = action.querySelector<HTMLElement>('[data-quick-action-icon]')!;
          const card = action.querySelector<HTMLElement>('a > div')!;
          const [foreground, background] = [
            luminance(getComputedStyle(icon).color),
            luminance(getComputedStyle(card).backgroundColor),
          ].sort((a, b) => b - a);
          return {
            tone: action.dataset.tone ?? '',
            foreground: getComputedStyle(icon).color,
            background: getComputedStyle(card).backgroundColor,
            ratio: (foreground + 0.05) / (background + 0.05),
          };
        });
      });
      for (const item of contrast.filter(({ ratio }) => ratio < 3)) {
        const viewportLabel = `${viewport.width}x${viewport.height}`;
        const key = `${theme}|${viewportLabel}|${item.tone}`;
        const existing = lowContrast.get(key);
        if (existing) {
          existing.actions += 1;
          if (item.ratio < existing.ratio) {
            existing.foreground = item.foreground;
            existing.background = item.background;
            existing.ratio = item.ratio;
          }
        } else {
          lowContrast.set(key, { ...item, theme, viewport: viewportLabel, actions: 1 });
        }
      }
    }
  }
  expect([...lowContrast.values()], 'Quick-action icon contrast below 3:1').toEqual([]);
});

test('permission-filtered Home actions do not leave stretched filler or Settings cards', async ({
  page,
}) => {
  await prepareFixture(page);
  const permissions = await page.evaluate(() => window.homePosTest!.allPermissions);
  const settingsPermission = await page.evaluate(() => window.homePosTest!.settingsPermission);
  const visible = permissions.filter((permission) => permission !== settingsPermission);
  await page.evaluate((allowed) => window.homePosTest!.mountQuickActions(allowed), visible);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-quick-action]')).toHaveCount(11);
  await expect(page.getByText('Configuración', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-quick-actions] > *')).toHaveCount(11);
  const widths = await page
    .locator('[data-quick-actions] a > div')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().width));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
});

test('top-product rank badges stay gold and legible across supported themes', async ({ page }) => {
  test.setTimeout(30_000);
  await prepareFixture(page);
  await page.evaluate(() => window.homePosTest!.mountRankBadges());
  const themes = await page.evaluate(() => window.homePosTest!.themes);
  const contrastFailures = new Map<
    string,
    {
      theme: string;
      viewports: string[];
      ranks: string[];
      textContrast: number;
      badgeContrast: number;
    }
  >();

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const family of themes) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(({ family, mode }) => window.homePosTest!.setTheme(family, mode), {
          family,
          mode,
        });
        await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
        const measurements = await page.locator('[data-rank]').evaluateAll((badges) =>
          badges.map((badge) => {
            const style = getComputedStyle(badge);
            const surface = getComputedStyle(badge.parentElement!).backgroundColor;
            const luminance = (value: string) => {
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d')!;
              context.fillStyle = value;
              context.fillRect(0, 0, 1, 1);
              return [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .reduce((sum, channel, index) => {
                  const color = channel / 255;
                  return (
                    sum +
                    [0.2126, 0.7152, 0.0722][index] *
                      (color <= 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4)
                  );
                }, 0);
            };
            const ratio = (foreground: string, background: string) => {
              const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
              return (a + 0.05) / (b + 0.05);
            };
            return {
              rank: badge.textContent,
              background: style.backgroundColor,
              textContrast: ratio(style.color, style.backgroundColor),
              badgeContrast: ratio(style.backgroundColor, surface),
            };
          })
        );

        expect(measurements.map(({ rank }) => rank)).toEqual(['1', '2', '3']);
        expect(measurements.map(({ background }) => background)).toEqual([
          'rgb(250, 204, 21)',
          'rgb(250, 204, 21)',
          'rgb(250, 204, 21)',
        ]);
        const theme = `${family}-${mode}`;
        for (const failure of measurements.filter(
          ({ textContrast, badgeContrast }) => textContrast < 4.5 || badgeContrast < 3
        )) {
          const existing = contrastFailures.get(theme);
          if (existing) {
            existing.ranks.push(failure.rank ?? '');
            if (!existing.viewports.includes(`${viewport.width}x${viewport.height}`)) {
              existing.viewports.push(`${viewport.width}x${viewport.height}`);
            }
            existing.textContrast = Math.min(existing.textContrast, failure.textContrast);
            existing.badgeContrast = Math.min(existing.badgeContrast, failure.badgeContrast);
          } else {
            contrastFailures.set(theme, {
              theme,
              viewports: [`${viewport.width}x${viewport.height}`],
              ranks: [failure.rank ?? ''],
              textContrast: failure.textContrast,
              badgeContrast: failure.badgeContrast,
            });
          }
        }
      }
    }
  }
  expect(
    [...contrastFailures.values()],
    'Top-product rank contrast below 4.5:1 text or 3:1 badge'
  ).toEqual([]);
});

test('the floating sidebar does not move Home content when opened or closed', async ({ page }) => {
  await prepareFixture(page);
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.homePosTest!.mountSidebar());
    await waitForLayout(page);
    const content = page.locator('[data-layout-content]');
    const initial = await content.boundingBox();
    const trigger = page.getByRole('button', { name: 'Toggle navigation' });
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    const isMobile = viewport.width < 768;
    await trigger.click();
    await expect(sidebar).toHaveAttribute('data-state', isMobile ? 'open' : 'expanded');
    expect(await content.boundingBox()).toEqual(initial);
    if (isMobile) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    } else {
      await trigger.click();
      await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
    }
    expect(await content.boundingBox()).toEqual(initial);
  }
});

test('Default light sidebar logout contrast is accessible on mobile and desktop', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.evaluate(() => window.homePosTest!.setTheme('default', 'light'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'default-light');
  const measurements = [];
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.homePosTest!.mountAppSidebar());
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    const logout = page.locator('[data-slot="sidebar-footer"] a[href="/logout"]');
    await expect(logout).toBeVisible();
    await waitForLayout(page);
    const contrast = await logout.evaluate((link) => {
      const context = document.createElement('canvas').getContext('2d')!;
      const ancestors: Element[] = [];
      for (let element: Element | null = link; element; element = element.parentElement) {
        ancestors.unshift(element);
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 1, 1);
      for (const element of ancestors) {
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const background = context.getImageData(0, 0, 1, 1);
      const luminance = (channels: Uint8ClampedArray) =>
        [...channels].slice(0, 3).reduce((sum, channel, index) => {
          const color = channel / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index] *
              (color <= 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      const ratio = (element: Element) => {
        context.putImageData(background, 0, 0);
        context.fillStyle = getComputedStyle(element).color;
        context.globalAlpha = Number(getComputedStyle(element).opacity);
        context.fillRect(0, 0, 1, 1);
        context.globalAlpha = 1;
        const [a, b] = [
          luminance(context.getImageData(0, 0, 1, 1).data),
          luminance(background.data),
        ].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      };
      const footer = link.closest<HTMLElement>('[data-slot="sidebar-footer"]')!;
      const profile = footer.querySelector('a[href="/profile"]')!;
      const profileColors = () => {
        const style = getComputedStyle(profile);
        return [style.color, style.backgroundColor, style.borderColor];
      };
      const originalProfile = profileColors();
      footer.style.setProperty(
        '--sidebar-foreground',
        getComputedStyle(document.documentElement).getPropertyValue('--sidebar-foreground')
      );
      const unscopedProfile = profileColors();
      footer.style.removeProperty('--sidebar-foreground');
      return {
        textContrast: ratio(link.querySelector('span')!),
        iconContrast: ratio(link.querySelector('svg')!),
        iconColor: getComputedStyle(link.querySelector('svg')!).color,
        originalProfile,
        unscopedProfile,
      };
    });
    measurements.push({ viewport: `${viewport.width}x${viewport.height}`, ...contrast });
    if (viewport.width < 768) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  }
  console.log('Sidebar logout contrast:', JSON.stringify(measurements));
  for (const measurement of measurements) {
    expect(measurement.originalProfile, `${measurement.viewport} Profile colors`).toEqual(
      measurement.unscopedProfile
    );
    expect
      .soft(measurement.textContrast, `${measurement.viewport} logout text`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(measurement.iconContrast, `${measurement.viewport} logout icon`)
      .toBeGreaterThanOrEqual(3);
  }
});

test('POS checkout bounds are measured without the Dashboard global footer', async ({ page }) => {
  await prepareFixture(page);
  const failures: string[] = [];
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.homePosTest!.mountSell());
    await waitForLayout(page);
    await expect(page.locator('[data-global-footer]')).toHaveCount(0);
    const measurements = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(
        `.${CSS.escape(window.homePosTest!.sellFooterClass)}`
      )!;
      const grid = document.querySelector<HTMLElement>(
        `.${CSS.escape(window.homePosTest!.sellGridClass)}`
      )!;
      const body = document.querySelector<HTMLElement>('[data-pos-ticket-body]')!;
      const lastLine = document.querySelector<HTMLElement>('[data-pos-line="last"]')!;
      body.scrollTop = body.scrollHeight;
      const footerRect = footer.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const lineRect = lastLine.getBoundingClientRect();
      return {
        footerDisplay: getComputedStyle(footer).display,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        gridBottom: gridRect.bottom,
        bodyBottom: bodyRect.bottom,
        lastLineBottom: lineRect.bottom,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyScrollTop: body.scrollTop,
        viewportHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    const viewportLabel = `${viewport.width}x${viewport.height}`;
    if (measurements.scrollWidth > viewport.width) {
      failures.push(`${viewportLabel} horizontal overflow: ${JSON.stringify(measurements)}`);
    }
    if (measurements.footerBottom > measurements.viewportHeight + 1) {
      failures.push(
        `${viewportLabel} checkout footer exceeds viewport: ${JSON.stringify(measurements)}`
      );
    }
    if (viewport.width < 1024) {
      if (measurements.footerDisplay === 'none') {
        failures.push(`${viewportLabel} sticky checkout footer is hidden`);
      }
      if (measurements.lastLineBottom > measurements.footerTop) {
        failures.push(
          `${viewportLabel} last ticket row overlaps checkout footer: ${JSON.stringify(measurements)}`
        );
      }
      if (measurements.bodyBottom > measurements.footerTop) {
        failures.push(
          `${viewportLabel} ticket body overlaps checkout footer: ${JSON.stringify(measurements)}`
        );
      }
    } else if (measurements.footerDisplay !== 'none') {
      failures.push(`${viewportLabel} mobile checkout footer remains visible`);
    }
  }
  expect(failures, 'POS checkout layout issues').toEqual([]);
});
