import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { build } from '../../../frontend/node_modules/vite/dist/node/index.js';
import { themeBootstrapPlugin } from '../../../frontend/themeBootstrapPlugin';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const frontendRoot = resolve(repositoryRoot, 'frontend');
const styleFiles = [
  resolve(frontendRoot, 'src', 'styles', 'base.css'),
  resolve(frontendRoot, 'src', 'styles', 'themes.css'),
  resolve(
    frontendRoot,
    'src',
    'features',
    'admin',
    'screens',
    'SettingsPage',
    'theme-preview.module.css'
  ),
].map((path) => readFileSync(path, 'utf8'));

const bootstrapOrigin = 'http://theme-bootstrap.test';
const assets = new Map<string, { contentType: string; body: string }>();
let runtimeEntry: string;

test.beforeAll(async () => {
  // Build the real HTML and styles with the production bootstrap transform.
  // This isolates the real hook/store, not App startup; theme-app-startup-helper covers that.
  const entry = '\0theme-runtime-fixture';
  const result = await build({
    root: frontendRoot,
    configFile: false,
    publicDir: false,
    logLevel: 'error',
    resolve: {
      alias: {
        '@': resolve(frontendRoot, 'src'),
        '@stores': resolve(frontendRoot, 'src/shared/stores'),
      },
    },
    plugins: [
      themeBootstrapPlugin(),
      {
        name: 'theme-runtime-fixture',
        enforce: 'pre',
        resolveId(id) {
          if (id === '/src/main.tsx') return entry;
        },
        load(id) {
          if (id !== entry) return;
          return `
            import { createElement, useEffect } from 'react';
            import { createRoot } from 'react-dom/client';
            import { useTheme } from '@/shared/hooks/useTheme';
            function Fixture() {
              const { activeTheme } = useTheme();
              useEffect(() => { document.body.dataset.runtimeTheme = activeTheme; }, [activeTheme]);
              return null;
            }
            createRoot(document.getElementById('root')).render(createElement(Fixture));
          `;
        },
      },
    ],
    build: { write: false, modulePreload: false },
  });
  for (const bundle of Array.isArray(result) ? result : [result]) {
    if (!('output' in bundle)) throw new Error('Expected in-memory Vite build outputs.');
    const { output } = bundle;
    for (const item of output) {
      if (item.type === 'chunk') {
        assets.set(`/${item.fileName}`, { contentType: 'text/javascript', body: item.code });
      } else if (item.fileName.endsWith('.css')) {
        assets.set(`/${item.fileName}`, { contentType: 'text/css', body: String(item.source) });
      } else if (item.fileName === 'index.html') {
        const html = String(item.source).replace(/<link\b[^>]*href="https?:\/\/[^>]*>/g, '');
        const moduleTag = html.match(/<script type="module"[^>]+src="([^"]+)"[^>]*><\/script>/);
        if (!moduleTag) throw new Error('The built runtime module script was not found.');
        runtimeEntry = moduleTag[1];
        assets.set('/', { contentType: 'text/html', body: html.replace(moduleTag[0], '') });
      }
    }
  }
});
const families = [
  'default',
  'classic',
  'ocean',
  'forest',
  'purple',
  'sunset',
  'shadcn',
  'custom',
] as const;
const modes = ['light', 'dark', 'system'] as const;
const osPreferences = ['light', 'dark'] as const;
const customPalette = {
  '--color-primary': '#123456',
  '--color-bg': '#f5e7d2',
  '--color-surface': '#cdeeff',
  '--color-text': '#24142f',
  '--color-border': '#608070',
} as const;

async function openBootstrapPage(
  browser: Browser,
  colorScheme: 'light' | 'dark',
  storedValue?: string
) {
  const context = await browser.newContext({ colorScheme });
  if (storedValue !== undefined) {
    await context.addInitScript((value) => {
      if (sessionStorage.getItem('theme-bootstrap-seeded') === 'true') return;
      localStorage.setItem('pos_ui_storage', value);
      sessionStorage.setItem('theme-bootstrap-seeded', 'true');
    }, storedValue);
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().startsWith('[Theme]')) {
      warnings.push(message.text());
    }
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === bootstrapOrigin) {
      const asset = assets.get(url.pathname);
      if (asset) return route.fulfill(asset);
    }
    return route.abort();
  });
  await page.goto(bootstrapOrigin);

  return { context, page, warnings, errors };
}

const savedPalette = {
  light: {
    primary: '#AbC',
    background: '#f5e7d2',
    accent: '#654321',
    surface: '#cdeeff',
    text: '#24142f',
    border: '#608070',
  },
  dark: {
    primary: '#2a4b6c',
    background: '#132435',
    accent: '#d3b2a1',
    surface: '#243546',
    text: '#e5d4c3',
    border: '#546576',
  },
};
const savedPaint = {
  light: {
    primary: 'rgb(170, 187, 204)',
    background: 'rgb(245, 231, 210)',
    accent: 'rgb(101, 67, 33)',
    surface: 'rgb(205, 238, 255)',
    text: 'rgb(36, 20, 47)',
    border: 'rgb(96, 128, 112)',
  },
  dark: {
    primary: 'rgb(42, 75, 108)',
    background: 'rgb(19, 36, 53)',
    accent: 'rgb(211, 178, 161)',
    surface: 'rgb(36, 53, 70)',
    text: 'rgb(229, 212, 195)',
    border: 'rgb(84, 101, 118)',
  },
};

async function readCustomPaint(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-primary)';
    probe.style.backgroundColor = 'var(--color-surface)';
    probe.style.border = '1px solid var(--color-border)';
    probe.style.outline = '1px solid var(--color-accent)';
    probe.textContent = 'Palette paint probe';
    document.body.append(probe);
    const computed = getComputedStyle(probe);
    const paint = {
      primary: computed.color,
      surface: computed.backgroundColor,
      border: computed.borderTopColor,
      accent: computed.outlineColor,
      background: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
    };
    probe.remove();
    return paint;
  });
}

for (const osMode of osPreferences) {
  for (const selectedMode of modes) {
    test(`saved custom ${selectedMode} palette paints before React and survives hook runtime (OS ${osMode})`, async ({
      browser,
    }) => {
      const storage = JSON.stringify({
        state: { themeFamily: 'custom', themeMode: selectedMode, themeCustomConfig: savedPalette },
        version: 0,
      });
      const { context, page, warnings, errors } = await openBootstrapPage(browser, osMode, storage);
      const resolvedMode = selectedMode === 'system' ? osMode : selectedMode;
      try {
        await expect(page.locator('body')).not.toHaveAttribute('data-runtime-theme');
        expect(await readCustomPaint(page)).toEqual(savedPaint[resolvedMode]);
        await page.reload();
        expect(await readCustomPaint(page)).toEqual(savedPaint[resolvedMode]);
        const bootstrapCss = await page.locator('#pos-custom-theme-vars').textContent();
        await page.addScriptTag({ type: 'module', url: runtimeEntry });
        await expect(page.locator('body')).toHaveAttribute(
          'data-runtime-theme',
          `custom-${resolvedMode}`
        );
        expect(await readCustomPaint(page)).toEqual(savedPaint[resolvedMode]);
        await expect(page.locator('#pos-custom-theme-vars')).toHaveCount(1);
        // Stylesheet source is not visible text for Playwright's toHaveText matcher.
        await expect
          .poll(() => page.locator('#pos-custom-theme-vars').textContent())
          .toBe(bootstrapCss);
        const nextMode = osMode === 'light' ? 'dark' : 'light';
        await page.emulateMedia({ colorScheme: nextMode });
        const nextResolvedMode = selectedMode === 'system' ? nextMode : selectedMode;
        await expect(page.locator('body')).toHaveAttribute(
          'data-runtime-theme',
          `custom-${nextResolvedMode}`
        );
        await expect.poll(() => readCustomPaint(page)).toEqual(savedPaint[nextResolvedMode]);
        const persisted = await page.evaluate(() =>
          JSON.parse(localStorage.getItem('pos_ui_storage') ?? 'null')
        );
        expect(persisted).toMatchObject({
          state: {
            themeFamily: 'custom',
            themeMode: selectedMode,
            themeCustomConfig: savedPalette,
          },
          version: 0,
        });
        expect(warnings).toEqual([]);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test('custom hook handoff rejects CSS injection without replacing saved color strings', async ({
  browser,
}) => {
  const storage = JSON.stringify({
    state: {
      themeFamily: 'custom',
      themeMode: 'light',
      themeCustomConfig: {
        light: {
          ...savedPalette.light,
          primary: '#fff; } body { background: red } /*',
        },
        dark: null,
      },
    },
    version: 0,
  });
  const { context, page, warnings, errors } = await openBootstrapPage(browser, 'dark', storage);
  try {
    const expected = { ...savedPaint.light, primary: 'rgb(34, 197, 94)' };
    expect(await readCustomPaint(page)).toEqual(expected);
    expect(await page.locator('#pos-custom-theme-vars').textContent()).not.toContain(
      'background: red'
    );
    await page.addScriptTag({ type: 'module', url: runtimeEntry });
    await expect(page.locator('body')).toHaveAttribute('data-runtime-theme', 'custom-light');
    expect(await readCustomPaint(page)).toEqual(expected);
    const persisted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pos_ui_storage') ?? 'null')
    );
    expect(persisted.state.themeCustomConfig.light).toEqual({
      ...savedPalette.light,
      primary: '#fff; } body { background: red } /*',
    });
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

async function expectStartupTheme(
  page: Page,
  family: string,
  mode: 'light' | 'dark'
): Promise<void> {
  const startup = await page.locator('html').evaluate((root) => ({
    theme: root.getAttribute('data-theme'),
    mode: root.getAttribute('data-theme-mode'),
    dark: root.classList.contains('dark'),
    colorScheme: (root as HTMLElement).style.colorScheme,
  }));
  expect(startup).toEqual({
    theme: `${family}-${mode}`,
    mode,
    dark: mode === 'dark',
    colorScheme: mode,
  });
}

for (const family of families) {
  test(`cold startup resolves persisted ${family} family and modes`, async ({ browser }) => {
    for (const colorScheme of osPreferences) {
      for (const mode of modes) {
        const storage = JSON.stringify({ state: { themeFamily: family, themeMode: mode } });
        const { context, page } = await openBootstrapPage(browser, colorScheme, storage);
        const resolvedMode = mode === 'system' ? colorScheme : mode;

        await expectStartupTheme(page, family, resolvedMode);
        await page.reload();
        await expectStartupTheme(page, family, resolvedMode);

        await context.close();
      }
    }
  });
}

test('cold startup falls back safely for missing or malformed preferences', async ({ browser }) => {
  const cases: {
    description: string;
    storage?: string;
    family: string;
    mode: 'system' | 'dark';
    warning?: string;
  }[] = [
    { description: 'missing storage', family: 'default', mode: 'system' },
    {
      description: 'malformed JSON',
      storage: '{broken',
      family: 'default',
      mode: 'system',
      warning: '[Theme] Could not read saved theme preferences; using defaults.',
    },
    {
      description: 'malformed envelope',
      storage: '{"state":null}',
      family: 'default',
      mode: 'system',
      warning: '[Theme] Invalid saved theme preferences; using defaults.',
    },
    {
      description: 'missing mode',
      storage: JSON.stringify({ state: { themeFamily: 'ocean' } }),
      family: 'ocean',
      mode: 'system',
    },
    {
      description: 'missing family',
      storage: JSON.stringify({ state: { themeMode: 'dark' } }),
      family: 'default',
      mode: 'dark',
    },
  ];

  for (const colorScheme of osPreferences) {
    for (const scenario of cases) {
      const { context, page, warnings } = await openBootstrapPage(
        browser,
        colorScheme,
        scenario.storage
      );
      const resolvedMode = scenario.mode === 'system' ? colorScheme : scenario.mode;

      await expectStartupTheme(page, scenario.family, resolvedMode);
      expect(warnings, scenario.description).toEqual(scenario.warning ? [scenario.warning] : []);
      await page.reload();
      await expectStartupTheme(page, scenario.family, resolvedMode);

      await context.close();
    }
  }
});

for (const mode of ['light', 'dark'] as const) {
  test(`preset and custom preview tokens are isolated from every enclosing ${mode} family`, async ({
    page,
  }) => {
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<main></main>');
    for (const css of styleFiles) {
      await page.addStyleTag({ content: css });
    }

    const mismatches = await page.evaluate(
      ({ families, mode, customPalette }) => {
        const root = document.documentElement;
        const tokens = [
          '--color-primary',
          '--color-bg',
          '--color-surface',
          '--color-text',
          '--color-border',
        ];
        const mismatches: {
          theme: string;
          enclosingFamily: string;
          token: string;
          applied: string;
          preview: string;
        }[] = [];

        const applyCustomPalette = (element: HTMLElement) => {
          Object.entries(customPalette).forEach(([name, value]) => {
            element.style.setProperty(name, value);
          });
        };
        const createPreview = (theme: string) => {
          const preview = document.createElement('div');
          preview.className = 'preview';
          preview.dataset.theme = `${theme}-${mode}`;
          preview.style.colorScheme = mode;
          if (theme === 'custom') applyCustomPalette(preview);

          const sidebar = document.createElement('div');
          sidebar.className = 'sidebar';
          const content = document.createElement('div');
          content.className = 'content';
          const heading = document.createElement('div');
          heading.className = 'heading';
          const text = document.createElement('div');
          text.className = 'text';
          const card = document.createElement('div');
          card.className = 'card';
          const accent = document.createElement('div');
          accent.className = 'accent';
          const accentLine = document.createElement('div');
          accentLine.className = 'accentLine';
          card.append(accent, accentLine);
          content.append(heading, text, card);
          preview.append(sidebar, content);
          return preview;
        };
        const readPreviewColors = (preview: HTMLElement): Record<string, string> => {
          const computed = getComputedStyle(preview);
          const childStyle = (className: string) =>
            getComputedStyle(preview.querySelector(`.${className}`) as HTMLElement);
          const colors: Record<string, string> = {};
          tokens.forEach((token) => {
            colors[token] = computed.getPropertyValue(token).trim();
          });
          colors.border = computed.borderTopColor;
          colors.sidebar = childStyle('sidebar').backgroundColor;
          colors.sidebarBorder = childStyle('sidebar').borderRightColor;
          colors.content = childStyle('content').backgroundColor;
          colors.heading = childStyle('heading').backgroundColor;
          colors.text = childStyle('text').backgroundColor;
          colors.card = childStyle('card').backgroundColor;
          colors.cardBorder = childStyle('card').borderTopColor;
          colors.accent = childStyle('accent').backgroundColor;
          colors.accentLine = childStyle('accentLine').backgroundColor;
          colors.colorScheme = computed.colorScheme;
          return colors;
        };

        for (const theme of families) {
          root.removeAttribute('style');
          root.dataset.theme = `${theme}-${mode}`;
          root.style.colorScheme = mode;
          if (theme === 'custom') applyCustomPalette(root);
          const appliedPreview = createPreview(theme);
          appliedPreview.removeAttribute('data-theme');
          document.body.appendChild(appliedPreview);
          const appliedColors = readPreviewColors(appliedPreview);
          appliedPreview.remove();

          for (const enclosingFamily of families) {
            root.removeAttribute('style');
            root.dataset.theme = `${enclosingFamily}-${mode}`;
            root.style.colorScheme = mode;
            if (enclosingFamily === 'custom') {
              root.style.setProperty('--color-primary', '#a31f50');
              root.style.setProperty('--color-bg', '#43182f');
              root.style.setProperty('--color-surface', '#de5842');
              root.style.setProperty('--color-text', '#ffedca');
              root.style.setProperty('--color-border', '#82ccaa');
            }

            const preview = createPreview(theme);
            document.body.appendChild(preview);
            const previewColors = readPreviewColors(preview);

            for (const token of Object.keys(appliedColors)) {
              if (appliedColors[token] !== previewColors[token]) {
                mismatches.push({
                  theme,
                  enclosingFamily,
                  token,
                  applied: appliedColors[token],
                  preview: previewColors[token],
                });
              }
            }

            preview.remove();
          }
        }

        return mismatches;
      },
      { families, mode, customPalette }
    );

    expect(mismatches).toEqual([]);
  });
}
