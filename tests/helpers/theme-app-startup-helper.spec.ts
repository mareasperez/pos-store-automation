import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Route } from '@playwright/test';
import type { ViteDevServer } from '../../../frontend/node_modules/vite/dist/node/index.js';
import { startThemeTestServer } from './theme-test-server';
import { themeBootstrapPlugin } from '../../../frontend/scripts/vite/themeBootstrapPlugin';
import { themeCatalog } from '../../../frontend/src/features/admin/screens/SettingsPage/themeCatalog';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend');
const frontendRequire = createRequire(resolve(frontendRoot, 'package.json'));
const mockApiOrigin = 'http://127.0.0.1:0';
let server: ViteDevServer;
let origin: string;

function mockLoginConfig(route: Route) {
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET',
  };
  return route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers })
    : route.fulfill({ headers, json: { captchaRequired: false } });
}

// Injected as a classic body-prepend script: stylesheets are ready, main.tsx has not run.
function samplePaint() {
  const probe = document.createElement('span');
  probe.style.color = 'var(--color-primary)';
  probe.style.backgroundColor = 'var(--color-surface)';
  probe.style.border = '1px solid var(--color-border)';
  probe.style.outline = '1px solid var(--color-accent)';
  probe.textContent = 'Palette paint probe';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const snapshot = {
    paint: {
      primary: style.color,
      surface: style.backgroundColor,
      border: style.borderTopColor,
      accent: style.outlineColor,
      background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
    },
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.themeMode,
    dark: document.documentElement.classList.contains('dark'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    storage: localStorage.getItem('pos_ui_storage'),
  };
  probe.remove();
  return snapshot;
}

type Snapshot = ReturnType<typeof samplePaint>;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const { default: react } = await import(
    pathToFileURL(frontendRequire.resolve('@vitejs/plugin-react')).href
  );
  const { default: tailwindcss } = await import(
    pathToFileURL(frontendRequire.resolve('@tailwindcss/vite')).href
  );
  server = await startThemeTestServer({
    root: frontendRoot,
    configFile: false,
    envFile: false,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_USE_RUNTIME_CONFIG': JSON.stringify('false'),
      'import.meta.env.VITE_SENTRY_ENABLED': JSON.stringify('false'),
      'import.meta.env.VITE_API_URL': JSON.stringify(mockApiOrigin),
    },
    resolve: {
      alias: Object.fromEntries(
        Object.entries({
          '@': 'src',
          '@core': 'src/core',
          '@components': 'src/shared/components',
          '@hooks': 'src/shared/hooks',
          '@stores': 'src/shared/stores',
          '@utils': 'src/shared/utils',
          '@constants': 'src/shared/constants',
          '@services': 'src/shared/services',
          '@styles': 'src/styles',
          '@types': 'src/shared/types',
          '@assets': 'src/assets',
        }).map(([alias, target]) => [alias, resolve(frontendRoot, target)])
      ),
    },
    plugins: [
      themeBootstrapPlugin(),
      tailwindcss(),
      react(),
      {
        name: 'observe-pre-app-theme',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            return {
              // External font/preconnect links are irrelevant to palette paint and must stay offline.
              html: html.replace(/<link\b[^>]*href="https?:\/\/[^>]*>/g, ''),
              tags: [
                {
                  tag: 'script',
                  injectTo: 'body-prepend',
                  children: `window.__themeBeforeApp = (${samplePaint.toString()})();`,
                },
              ],
            };
          },
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
  if (!origin) {
    await server.close();
    throw new Error('Local theme App server did not start.');
  }
});

test.afterAll(async () => {
  await server?.close();
});

const palette = {
  light: {
    primary: '#AbC',
    accent: '#654321',
    background: '#f5e7d2',
    surface: '#cdeeff',
    text: '#24142f',
    border: '#608070',
  },
  dark: {
    primary: '#2a4b6c',
    accent: '#d3b2a1',
    background: '#132435',
    surface: '#243546',
    text: '#e5d4c3',
    border: '#546576',
  },
};

const darkPaint = {
  primary: 'rgb(42, 75, 108)',
  accent: 'rgb(211, 178, 161)',
  background: 'rgb(19, 36, 53)',
  surface: 'rgb(36, 53, 70)',
  text: 'rgb(229, 212, 195)',
  border: 'rgb(84, 101, 118)',
};

const lightPaint = {
  primary: 'rgb(170, 187, 204)',
  accent: 'rgb(101, 67, 33)',
  background: 'rgb(245, 231, 210)',
  surface: 'rgb(205, 238, 255)',
  text: 'rgb(36, 20, 47)',
  border: 'rgb(96, 128, 112)',
};

const partialPalette = {
  light: palette.light,
  dark: {
    primary: palette.dark.primary,
    accent: palette.dark.accent,
    background: palette.dark.background,
    surface: 42,
    border: palette.dark.border,
  },
};

for (const scenario of [
  { name: 'complete', saved: palette, persisted: palette, paint: darkPaint },
  {
    name: 'partial',
    saved: partialPalette,
    persisted: {
      light: palette.light,
      dark: { ...palette.dark, surface: '#1f2937', text: '#f8fafc' },
    },
    paint: { ...darkPaint, surface: 'rgb(31, 41, 55)', text: 'rgb(248, 250, 252)' },
  },
]) {
  test(`real App preserves ${scenario.name} saved custom paint and strings through startup and reload`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      colorScheme: 'dark',
      locale: 'es',
      serviceWorkers: 'block',
    });
    const storage = JSON.stringify({
      state: { themeFamily: 'custom', themeMode: 'system', themeCustomConfig: scenario.saved },
      version: 0,
    });
    await context.addInitScript((saved) => {
      if (sessionStorage.getItem('theme-app-seeded')) return;
      localStorage.setItem('pos_ui_storage', saved);
      sessionStorage.setItem('theme-app-seeded', 'true');
    }, storage);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === mockApiOrigin && url.pathname === '/api/auth/login-config') {
        return mockLoginConfig(route);
      }
      return url.origin === origin ? route.continue() : route.abort();
    });
    try {
      for (const visit of [
        { navigate: () => page.goto(`${origin}/login`), configBeforeApp: scenario.saved },
        { navigate: () => page.reload(), configBeforeApp: scenario.persisted },
      ]) {
        await visit.navigate();
        await expect(page.locator('#username')).toBeVisible();
        const before = await page.evaluate(
          () => (window as Window & { __themeBeforeApp: Snapshot }).__themeBeforeApp
        );
        expect(before.paint).toEqual(scenario.paint);
        expect(before).toMatchObject({
          theme: 'custom-dark',
          mode: 'dark',
          dark: true,
          colorScheme: 'dark',
        });
        await expect
          .poll(() => page.evaluate(samplePaint))
          .toMatchObject({
            paint: scenario.paint,
            theme: 'custom-dark',
            mode: 'dark',
            dark: true,
            colorScheme: 'dark',
          });
        const after = await page.evaluate(samplePaint);
        const persisted = JSON.parse(after.storage ?? 'null');
        expect(persisted.state.themeCustomConfig).toEqual(scenario.persisted);
        expect(persisted.state).toMatchObject({ themeFamily: 'custom', themeMode: 'system' });
        expect(persisted.state).toHaveProperty('language', 'es');
        expect(JSON.parse(before.storage ?? 'null').state.themeCustomConfig).toEqual(
          visit.configBeforeApp
        );
      }
      await page.emulateMedia({ colorScheme: 'light' });
      await expect
        .poll(() => page.evaluate(samplePaint))
        .toMatchObject({
          paint: lightPaint,
          theme: 'custom-light',
          mode: 'light',
          dark: false,
          colorScheme: 'light',
        });
      const persistedAfterModeChange = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('pos_ui_storage') ?? 'null')
      );
      expect(persistedAfterModeChange.state).toMatchObject({
        themeFamily: 'custom',
        themeMode: 'system',
        themeCustomConfig: scenario.persisted,
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

async function authTextContrast(text: Locator) {
  return text.evaluate(async (element) => {
    const card = element.closest('.card--auth');
    if (!card) throw new Error('Expected text inside the rendered auth Card.');

    const ancestors: Element[] = [];
    for (let layer: Element | null = element; layer; layer = layer.parentElement) {
      ancestors.push(layer);
    }
    // Measure settled paint, not the login page's fade-in.
    await Promise.allSettled(
      ancestors.flatMap((layer) => layer.getAnimations().map((a) => a.finished))
    );

    const styles = ancestors.map((layer) => getComputedStyle(layer));
    if (styles.some((style) => style.opacity !== '1')) {
      throw new Error('Expected full opacity after auth animations.');
    }
    // Let Chromium convert modern color syntax (e.g. shadcn OKLCH) to sRGB.
    const probe = document.createElement('span');
    function rgba(color: string) {
      const match = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(color);
      if (match) return { rgb: match.slice(1, 4).map(Number), alpha: Number(match[4] ?? 1) };

      probe.style.color = `color(from ${color} srgb r g b / alpha)`;
      document.body.append(probe);
      const converted = getComputedStyle(probe).color;
      probe.remove();
      const srgb = /^color\(srgb ([^ ]+) ([^ ]+) ([^ /)]+)(?: \/ ([^)]+))?\)$/.exec(converted);
      if (!srgb) throw new Error(`Unsupported computed auth color: ${color} → ${converted}`);
      return {
        rgb: srgb.slice(1, 4).map((channel) => 255 * Math.max(0, Math.min(1, Number(channel)))),
        alpha: Number(srgb[4] ?? 1),
      };
    }

    const layers = [];
    for (const style of styles) {
      if (style.backgroundImage !== 'none') throw new Error('Expected flat auth backgrounds.');
      const background = rgba(style.backgroundColor);
      layers.push(background);
      if (background.alpha === 1) break;
    }
    if (layers.at(-1)?.alpha !== 1) throw new Error('No opaque auth backdrop found.');

    function composite({ rgb, alpha }: ReturnType<typeof rgba>, backdrop: number[]) {
      return rgb.map((channel, i) => channel * alpha + backdrop[i] * (1 - alpha));
    }
    function luminance(rgb: number[]) {
      const [r, g, b] = rgb.map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const backdrop = layers.reduceRight((below, layer) => composite(layer, below), [0, 0, 0]);
    const textLuminance = luminance(composite(rgba(styles[0].color), backdrop));
    const backgroundLuminance = luminance(backdrop);
    return (
      (Math.max(textLuminance, backgroundLuminance) + 0.05) /
      (Math.min(textLuminance, backgroundLuminance) + 0.05)
    );
  });
}

test('auth text contrast on real public routes across catalog themes and modes', async ({
  browser,
}, testInfo) => {
  test.setTimeout(360_000);
  for (const { id: family } of themeCatalog) {
    for (const mode of ['light', 'dark'] as const) {
      await test.step(`${family} ${mode}`, async () => {
        const context = await browser.newContext({ locale: 'es', serviceWorkers: 'block' });
        try {
          await context.addInitScript(
            (state) =>
              localStorage.setItem('pos_ui_storage', JSON.stringify({ state, version: 0 })),
            { themeFamily: family, themeMode: mode }
          );
          const page = await context.newPage();
          let recoverySucceeds = false;
          await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin === mockApiOrigin) {
              if (url.pathname === '/api/auth/login-config') return mockLoginConfig(route);
              const headers = {
                'access-control-allow-origin': origin,
                'access-control-allow-credentials': 'true',
                'access-control-allow-headers': 'content-type',
                'access-control-allow-methods': 'POST',
              };
              const method = route.request().method();
              if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
              if (method === 'POST' && url.pathname === '/api/auth/login') {
                return route.fulfill({ status: 401, headers, json: {} });
              }
              if (method === 'POST' && url.pathname === '/api/auth/forgot-password') {
                return route.fulfill({ status: recoverySucceeds ? 200 : 500, headers, json: {} });
              }
            }
            return url.origin === origin ? route.continue() : route.abort();
          });

          const ratios: Record<string, number> = {};
          await page.goto(`${origin}/login`);
          await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
          const forgotLink = page.getByRole('link', { name: '¿Olvidaste tu contraseña?' });
          await expect(forgotLink).toBeVisible();
          ratios['Forgot-password link'] = await authTextContrast(forgotLink);

          await page.locator('#username').fill('contrast-test');
          await page.locator('#password').fill('not-a-real-password');
          await page.locator('button[type="submit"]').click();
          const alert = page.getByRole('alert');
          await expect(alert).toHaveText('Credenciales inválidas');
          ratios['Login error'] = await authTextContrast(alert);

          await forgotLink.click();
          await page.locator('#email').fill('contrast@example.test');
          await page.getByRole('button', { name: 'Enviar enlace' }).click();
          await expect(alert).toHaveText('Ocurrió un error. Por favor inténtalo de nuevo.');
          ratios['Forgot-password error'] = await authTextContrast(alert);

          recoverySucceeds = true;
          await page.getByRole('button', { name: 'Enviar enlace' }).click();
          const recoverySuccess = page.getByText(
            'Si tu correo está registrado, recibirás un enlace en breve.',
            { exact: true }
          );
          await expect(recoverySuccess).toBeVisible();
          ratios['Forgot-password success'] = await authTextContrast(recoverySuccess);

          await page.goto(`${origin}/reset-password?token=contrast-test`);
          await page.locator('#password').fill('first-password');
          await page.locator('#confirmPassword').fill('different-password');
          await page.getByRole('button', { name: 'Cambiar Contraseña' }).click();
          await expect(alert).toHaveText('Las contraseñas no coinciden');
          ratios['Reset-password error'] = await authTextContrast(alert);

          await page.goto(`${origin}/reset-password`);
          const missingToken = page.getByText('El enlace es inválido o ha expirado', {
            exact: true,
          });
          await expect(missingToken).toBeVisible();
          ratios['Reset-password missing token'] = await authTextContrast(missingToken);

          await testInfo.attach(`${family} ${mode} contrast ratios`, {
            body: JSON.stringify(ratios),
            contentType: 'application/json',
          });
          for (const [state, ratio] of Object.entries(ratios)) {
            expect
              .soft(ratio, `${family} ${mode} — ${state} (${ratio.toFixed(2)}:1)`)
              .toBeGreaterThanOrEqual(4.5);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
});
