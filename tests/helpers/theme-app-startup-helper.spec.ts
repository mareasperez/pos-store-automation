import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  createServer,
  type ViteDevServer,
} from '../../../frontend/node_modules/vite/dist/node/index.js';
import { themeBootstrapPlugin } from '../../../frontend/themeBootstrapPlugin';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../frontend');
const frontendRequire = createRequire(resolve(frontendRoot, 'package.json'));
let server: ViteDevServer;
let origin: string;

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
  server = await createServer({
    root: frontendRoot,
    configFile: false,
    envFile: false,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_USE_RUNTIME_CONFIG': JSON.stringify('false'),
      'import.meta.env.VITE_SENTRY_ENABLED': JSON.stringify('false'),
      'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:0'),
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
  await server.listen();
  origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
  if (!origin) throw new Error('Local theme App server did not start.');
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
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
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
