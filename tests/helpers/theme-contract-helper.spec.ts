import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const frontend = resolve(process.cwd(), '..', 'frontend');
let server: { close: () => Promise<void>; resolvedUrls: { local: string[] } | null };
let origin: string;

test.beforeAll(async () => {
  const viteUrl = pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href;
  const tailwindUrl = pathToFileURL(
    resolve(frontend, 'node_modules/@tailwindcss/vite/dist/index.mjs')
  ).href;
  const { createServer } = await import(viteUrl);
  const { default: tailwindcss } = await import(tailwindUrl);
  server = await createServer({
    root: frontend,
    configFile: false,
    plugins: [
      tailwindcss(),
      {
        name: 'theme-contract-fixture',
        resolveId(id: string) {
          return id === 'virtual:theme-contract' ? '\0theme-contract' : undefined;
        },
        load(id: string) {
          if (id !== '\0theme-contract') return undefined;
          return `
            import '/src/styles/base.css';
            import '/src/styles/themes.css';
            import '/src/shared/components/ui/primitives/Button/button.css';
            import '/src/shared/components/ui/primitives/Badge/Badge.css';
            import '/src/shared/components/ui/inputs/Input/input.css';
            import '/src/shared/components/ui/inputs/Textarea/textarea.css';
            import '/src/shared/components/ui/feedback/Money/money.css';
            import '/src/shared/components/ui/search/GlobalProductSearch/global-product-search.css';
            import '/src/index.css';
            import tenantStyles from '/src/features/organization/components/TenantDetailsDrawer.module.css';
            import productStyles from '/src/features/catalog/components/ProductCard/product-card.module.css';
            import discountStyles from '/src/features/sales/components/ManualSaleDiscountControl/manual-sale-discount-control.module.css';
            import searchStyles from '/src/features/catalog/screens/ProductSearch/product-search-page.module.css';
            import tableStyles from '/src/shared/components/ui/table/TableState.module.css';
            import modalStyles from '/src/features/catalog/components/ProductSearchModal/product-search-modal.module.css';
            import inventoryStyles from '/src/features/inventory/styles/inventory-transaction.module.css';
            import orderStyles from '/src/features/sales/components/OrderContext/OrderContext.module.css';
            import { Select } from '/src/shared/components/ui/inputs/Select/Select.tsx';
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { useTheme } from '/src/shared/hooks/useTheme.ts';
            import { useUIStore, DEFAULT_THEME_CUSTOM_CONFIG } from '/src/shared/stores/useUIStore.ts';
            import { themeCatalog } from '/src/features/admin/screens/SettingsPage/themeCatalog.ts';
            function Harness() { useTheme(); return null; }
            useUIStore.setState({themeCustomConfig: DEFAULT_THEME_CUSTOM_CONFIG});
            function mountSelect() {
              const container = document.createElement('div');
              container.className = orderStyles['order-context'];
              document.body.appendChild(container);
              createRoot(container).render(React.createElement(Select, {
                name: 'saleWarehouse', value: '', onChange: () => {},
                error: 'Uno o más productos sin stock en esta bodega'
              }));
            }
            async function mountImport(withFile = false, failure = '') {
              const { DataImportModal } = await import('/src/shared/components/business/DataImportModal/DataImportModal.tsx');
              const container = document.createElement('div');
              document.body.appendChild(container);
              createRoot(container).render(React.createElement(DataImportModal, {
                isOpen: true, onClose: () => {}, onSuccess: () => {}, title: 'Import',
                onDownloadTemplate: async () => {
                  if (failure === 'download') throw new Error('Download failed');
                },
                onImport: async () => ({ successCount: 0, failureCount: 1, messages: ['Import error'] }),
                onPreviewImport: async () => {
                  if (failure === 'preview') throw new Error('Preview failed');
                  return { headers: [], rows: [], totalRows: 0, previewRows: 0, truncated: false };
                },
                importEntityLabel: 'products',
                initialFile: withFile ? new File(['fixture'], 'products.xlsx') : null
              }));
            }
            async function mountUserForm() {
              const { UserForm } = await import('/src/shared/components/features/UserForm/UserForm.tsx');
              const { default: AuthContext } = await import('/src/auth/UserContext.tsx');
              const container = document.createElement('div');
              container.style.backgroundColor = 'var(--color-surface)';
              document.body.appendChild(container);
              createRoot(container).render(
                React.createElement(AuthContext.Provider, { value: { user: null } },
                  React.createElement(UserForm, {
                    initialData: { id: 1, username: 'testuser', fullName: 'Test User', displayName: 'Test', email: 'test@example.com', active: true },
                    onSubmit: async () => {}, onCancel: () => {}
                  })
                )
              );
            }
            window.themeTest = {useUIStore, themeCatalog, tenantStyles, productStyles, discountStyles, searchStyles, tableStyles, modalStyles, inventoryStyles, mountSelect, mountImport, mountUserForm};
            createRoot(document.getElementById('root')).render(React.createElement(Harness));
          `;
        },
      },
    ],
    optimizeDeps: {
      noDiscovery: true,
      include: [
        'react',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
        'react-i18next',
        'zustand',
      ],
    },
    resolve: {
      alias: [
        { find: '@stores', replacement: resolve(frontend, 'src/shared/stores') },
        { find: '@components', replacement: resolve(frontend, 'src/shared/components') },
        { find: '@hooks', replacement: resolve(frontend, 'src/shared/hooks') },
        { find: '@utils', replacement: resolve(frontend, 'src/shared/utils') },
        { find: '@services', replacement: resolve(frontend, 'src/shared/services') },
        { find: '@types', replacement: resolve(frontend, 'src/shared/types') },
        { find: '@', replacement: resolve(frontend, 'src') },
      ],
    },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  await (server as unknown as { listen: () => Promise<void> }).listen();
  origin = server.resolvedUrls!.local[0].replace(/\/$/, '');
});

test.afterAll(async () => {
  await server?.close();
});

async function prepareFixture(page: Page) {
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    return route.abort();
  });
  await page.route(`${origin}/theme-contract-fixture`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/@id/__x00__theme-contract"></script></body></html>`,
    })
  );
  await page.goto(`${origin}/theme-contract-fixture`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { themeTest?: unknown }).themeTest)
  );
}

test('candidate token cross-product and adapters resolve across families and modes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog } = (
      window as unknown as {
        themeTest: {
          useUIStore: { setState: (state: object) => void };
          themeCatalog: { id: string }[];
        };
      }
    ).themeTest;
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgb = (value: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#010203';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const color = (token: string): number[] => {
      probe.style.color = `var(${token})`;
      return rgb(getComputedStyle(probe).color);
    };
    const luminance = (channels: number[]) =>
      channels.reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (x + 0.05) / (y + 0.05);
    };
    const results: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
          results.push(`${id}-${mode}: theme not applied`);
          continue;
        }
        const pairs: [string, string, number][] = [
          ['--color-primary-foreground', '--color-primary', 4.5],
          ['--color-primary-foreground', '--color-primary-dark', 4.5],
          ['--color-primary-foreground', '--color-primary-light', 4.5],
          ['--color-danger-foreground', '--color-danger-active', 4.5],
          ...['success', 'warning', 'danger', 'info'].map((name): [string, string, number] => [
            `--color-${name}-foreground`,
            `--color-${name}`,
            4.5,
          ]),
        ];
        for (const background of ['bg', 'surface', 'surface-alt']) {
          pairs.push([`--color-${background}-foreground`, `--color-${background}`, 4.5]);
          for (const foreground of [
            'text',
            'text-soft',
            'text-muted',
            'link',
            'link-hover',
            'primary',
            'success',
            'warning',
            'danger',
            'info',
          ]) {
            pairs.push([`--color-${foreground}`, `--color-${background}`, 4.5]);
          }
          pairs.push(['--color-focus', `--color-${background}`, 3]);
        }
        for (const [fg, bg, minimum] of pairs) {
          const value = ratio(color(fg), color(bg));
          if (value < minimum)
            results.push(`${id}-${mode}: ${fg} on ${bg}: ${value.toFixed(2)} < ${minimum}`);
        }
        for (const status of ['success', 'warning', 'danger']) {
          probe.style.backgroundColor = `color-mix(in srgb, var(--color-${status}) 15%, var(--color-surface))`;
          const value = ratio(
            color(`--color-${status}`),
            rgb(getComputedStyle(probe).backgroundColor)
          );
          if (value < 4.5)
            results.push(
              `${id}-${mode}: --color-${status} on 15% status/surface mix: ${value.toFixed(2)} < 4.5`
            );
          probe.style.backgroundColor = '';
        }
        for (const [alias, canonical] of [
          ['--primary', '--color-primary'],
          ['--primary-foreground', '--color-primary-foreground'],
          ['--destructive', '--color-danger'],
          ['--destructive-foreground', '--color-danger-foreground'],
          ['--success', '--color-success'],
          ['--success-foreground', '--color-success-foreground'],
          ['--warning', '--color-warning'],
          ['--warning-foreground', '--color-warning-foreground'],
          ['--info', '--color-info'],
          ['--info-foreground', '--color-info-foreground'],
          ['--background', '--color-bg'],
          ['--foreground', '--color-text-primary'],
          ['--card', '--color-surface'],
          ['--card-foreground', '--color-text-primary'],
          ['--popover', '--color-surface'],
          ['--popover-foreground', '--color-text-primary'],
          ['--secondary', '--color-surface-alt'],
          ['--secondary-foreground', '--color-text-primary'],
          ['--muted', '--color-surface-alt'],
          ['--muted-foreground', '--color-text-muted'],
          ['--accent', '--color-surface-hover'],
          ['--accent-foreground', '--color-text-primary'],
          ['--border', '--color-border'],
          ['--input', '--color-border'],
          ['--ring', '--color-focus'],
          ['--color-text-on-primary', '--color-primary-foreground'],
          ['--color-text-on-danger', '--color-danger-foreground'],
        ]) {
          const style = getComputedStyle(document.documentElement);
          if (
            !CSS.supports('color', style.getPropertyValue(alias).trim()) ||
            !CSS.supports('color', style.getPropertyValue(canonical).trim()) ||
            color(alias).join() !== color(canonical).join()
          ) {
            results.push(`${id}-${mode}: ${alias} does not resolve to ${canonical}`);
          }
        }
        for (const [classes, property, canonical] of [
          ['bg-primary', 'backgroundColor', '--color-primary'],
          ['text-primary-foreground', 'color', '--color-primary-foreground'],
          ['text-destructive', 'color', '--color-danger'],
          ['bg-card', 'backgroundColor', '--color-surface'],
          ['text-muted-foreground', 'color', '--color-text-muted'],
        ]) {
          probe.className = classes;
          probe.style.color = '';
          const rendered = getComputedStyle(probe)[property as 'color' | 'backgroundColor'];
          if (rgb(rendered).join() !== color(canonical).join()) {
            results.push(`${id}-${mode}: utility ${classes} does not resolve to ${canonical}`);
          }
        }
        const button = document.createElement('button');
        button.className = 'button button--danger';
        document.body.appendChild(button);
        const buttonStyle = getComputedStyle(button);
        if (ratio(rgb(buttonStyle.color), rgb(buttonStyle.backgroundColor)) < 4.5) {
          results.push(`${id}-${mode}: shared danger button text does not contrast`);
        }
        button.remove();
      }
    }
    return results;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('sale warehouse select error contrasts with its actual context in both layouts', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.evaluate(() => {
    (window as unknown as { themeTest: { mountSelect: () => void } }).themeTest.mountSelect();
  });
  const error = page.locator('.form-select__error');
  await expect(error).toHaveText('Uno o más productos sin stock en esta bodega');
  await expect(page.locator('select')).toHaveAttribute('aria-describedby', 'saleWarehouse-error');
  const failures: string[] = [];
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    const measured = await page.evaluate(async () => {
      const { useUIStore, themeCatalog } = (
        window as unknown as {
          themeTest: {
            useUIStore: { setState: (state: object) => void };
            themeCatalog: { id: string }[];
          };
        }
      ).themeTest;
      const error = document.querySelector<HTMLElement>('.form-select__error')!;
      const context = error.closest<HTMLElement>('[class*="order-context_"]')!;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const luminance = (value: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
          const c = channel / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index] *
              (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      };
      const results: string[] = [];
      for (const { id } of themeCatalog) {
        for (const mode of ['light', 'dark']) {
          useUIStore.setState({ themeFamily: id, themeMode: mode });
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
            results.push(`${id}-${mode}: theme not applied`);
            continue;
          }
          const foreground = getComputedStyle(error).color;
          const background = getComputedStyle(context);
          const stops =
            background.backgroundImage === 'none'
              ? [background.backgroundColor]
              : (background.backgroundImage.match(/(?:rgba?|color|oklch)\([^()]+\)/g) ?? []);
          const expectedStops = window.innerWidth > 768 ? 2 : 1;
          if (stops.length !== expectedStops) {
            results.push(
              `${id}-${mode}: unexpected context background ${background.backgroundImage}`
            );
          }
          for (const stop of stops) {
            const [a, b] = [luminance(foreground), luminance(stop)].sort((a, b) => b - a);
            const ratio = (a + 0.05) / (b + 0.05);
            if (ratio < 4.5) results.push(`${id}-${mode}: ${ratio.toFixed(2)}`);
          }
        }
      }
      return results;
    });
    failures.push(...measured.map((failure) => `${width}px ${failure}`));
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

test('import upload error and step indicator contrast on the modal surface', async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.addStyleTag({
    content: '* { transition: none !important; animation: none !important; }',
  });
  await page.evaluate(async () => {
    await (
      window as unknown as { themeTest: { mountImport: () => Promise<void> } }
    ).themeTest.mountImport();
  });
  const primary = page.locator('.modal-footer .button--primary');
  await expect(primary).toBeVisible();
  await primary.click();
  await primary.click();
  await primary.click();
  const error = page.locator('.modal-body p').last();
  await expect(error).toBeVisible();
  const indicator = page.locator('.modal-body span.text-xs.font-bold').filter({ hasText: /^3$/ });
  await expect(indicator).toBeVisible();
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog } = (
      window as unknown as {
        themeTest: {
          useUIStore: { setState: (state: object) => void };
          themeCatalog: { id: string }[];
        };
      }
    ).themeTest;
    const errors = document.querySelectorAll<HTMLElement>('.modal-body p');
    const error = errors[errors.length - 1];
    const indicator = [
      ...document.querySelectorAll<HTMLElement>('.modal-body span.text-xs.font-bold'),
    ].find((element) => element.textContent === '3')!;
    const surface = document.querySelector<HTMLElement>('.modal-content')!;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (background: string, overlay?: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1, 1);
      if (overlay) {
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    };
    const results: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
          results.push(`${id}-${mode}: theme not applied`);
          continue;
        }
        const surfaceColor = getComputedStyle(surface).backgroundColor;
        for (const [name, element, background] of [
          ['message', error, 'transparent'],
          ['indicator', indicator, getComputedStyle(indicator.parentElement!).backgroundColor],
        ] as const) {
          const [a, b] = [
            luminance(getComputedStyle(element).color),
            luminance(surfaceColor, background),
          ].sort((a, b) => b - a);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < 4.5) results.push(`${id}-${mode} ${name}: ${ratio.toFixed(2)}`);
        }
      }
    }
    return results;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

for (const failure of ['download', 'preview'] as const) {
  test(`import ${failure} error contrasts on the modal surface`, async ({ page }) => {
    test.setTimeout(60_000);
    await prepareFixture(page);
    await page.addStyleTag({
      content: '* { transition: none !important; animation: none !important; }',
    });
    await page.evaluate(async (failure) => {
      await (
        window as unknown as {
          themeTest: { mountImport: (withFile: boolean, failure: string) => Promise<void> };
        }
      ).themeTest.mountImport(failure === 'preview', failure);
    }, failure);
    const primary = page.locator('.modal-footer .button--primary');
    await expect(primary).toBeVisible();
    await primary.click();
    if (failure === 'download') {
      await page.locator('.modal-body button').first().click();
    } else {
      await primary.click();
      await primary.click();
      await primary.click();
    }
    const error = page.locator('.modal-body p').last();
    await expect(error).toBeVisible();
    if (failure === 'preview') await expect(error).toHaveText('Preview failed');
    else await expect(error).toContainText('file_too_large');
    const failures = await page.evaluate(async () => {
      const { useUIStore, themeCatalog } = (
        window as unknown as {
          themeTest: {
            useUIStore: { setState: (state: object) => void };
            themeCatalog: { id: string }[];
          };
        }
      ).themeTest;
      const errors = document.querySelectorAll<HTMLElement>('.modal-body p');
      const error = errors[errors.length - 1];
      const surface = document.querySelector<HTMLElement>('.modal-content')!;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const luminance = (value: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
          const c = channel / 255;
          return (
            sum +
            [0.2126, 0.7152, 0.0722][index] *
              (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      };
      const results: string[] = [];
      for (const { id } of themeCatalog) {
        for (const mode of ['light', 'dark']) {
          useUIStore.setState({ themeFamily: id, themeMode: mode });
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
            results.push(`${id}-${mode}: theme not applied`);
            continue;
          }
          const [a, b] = [
            luminance(getComputedStyle(error).color),
            luminance(getComputedStyle(surface).backgroundColor),
          ].sort((a, b) => b - a);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < 4.5) results.push(`${id}-${mode}: ${ratio.toFixed(2)}`);
        }
      }
      return results;
    });
    expect(failures, failures.join('\n')).toEqual([]);
  });
}

test('UserForm profile password mismatch contrasts on its error background', async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.evaluate(async () => {
    await (
      window as unknown as { themeTest: { mountUserForm: () => Promise<void> } }
    ).themeTest.mountUserForm();
  });
  const passwords = page.locator('form input[type="password"]');
  await expect(passwords).toHaveCount(2);
  await passwords.nth(0).fill('abc123');
  await passwords.nth(1).fill('xyz999');
  await page.locator('form button[type="submit"]').click();
  const error = page.locator('form > div[class*="danger-soft"]');
  await expect(error).toBeVisible();
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog } = (
      window as unknown as {
        themeTest: {
          useUIStore: { setState: (state: object) => void };
          themeCatalog: { id: string }[];
        };
      }
    ).themeTest;
    const error = document.querySelector<HTMLElement>('form > div[class*="danger-soft"]')!;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    };
    const results: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
          results.push(`${id}-${mode}: theme not applied`);
          continue;
        }
        const style = getComputedStyle(error);
        const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort(
          (a, b) => b - a
        );
        const ratio = (a + 0.05) / (b + 0.05);
        if (ratio < 4.5) results.push(`${id}-${mode}: ${ratio.toFixed(2)}`);
      }
    }
    return results;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('import result details and counts contrast on their actual backgrounds', async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.addStyleTag({
    content: '* { transition: none !important; animation: none !important; }',
  });
  await page.evaluate(async () => {
    await (
      window as unknown as { themeTest: { mountImport: (withFile: boolean) => Promise<void> } }
    ).themeTest.mountImport(true);
  });
  const primary = page.locator('.modal-footer .button--primary');
  for (let i = 0; i < 5; i++) await primary.click();
  await expect(page.getByText('Import error', { exact: true })).toBeVisible();
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog } = (
      window as unknown as {
        themeTest: {
          useUIStore: { setState: (state: object) => void };
          themeCatalog: { id: string }[];
        };
      }
    ).themeTest;
    const details = [...document.querySelectorAll<HTMLElement>('.modal-body li')].find(
      (element) => element.textContent === 'Import error'
    )!;
    const result = document.querySelector<HTMLElement>('.modal-body [role="alert"]')!;
    const counts = [...result.querySelectorAll<HTMLElement>('span.text-2xl')];
    const surface = document.querySelector<HTMLElement>('.modal-content')!;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (background: string, overlay?: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1, 1);
      if (overlay) {
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    };
    const results: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
          results.push(`${id}-${mode}: theme not applied`);
          continue;
        }
        const surfaceColor = getComputedStyle(surface).backgroundColor;
        for (const [name, element, background, minimum] of [
          ['details', details, details.closest('div')!, 4.5],
          ['success count', counts[0], counts[0].parentElement!.parentElement!, 3],
          ['failure count', counts[1], counts[1].parentElement!.parentElement!, 3],
        ] as const) {
          const [a, b] = [
            luminance(getComputedStyle(element).color),
            luminance(surfaceColor, getComputedStyle(background).backgroundColor),
          ].sort((a, b) => b - a);
          const ratio = (a + 0.05) / (b + 0.05);
          if (ratio < minimum)
            results.push(`${id}-${mode} ${name}: ${ratio.toFixed(2)} < ${minimum}`);
        }
      }
    }
    return results;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('ProductCard primary badges contrast at each gradient endpoint', async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog, productStyles } = (
      window as unknown as {
        themeTest: {
          useUIStore: { setState: (state: object) => void };
          themeCatalog: { id: string }[];
          productStyles: Record<string, string>;
        };
      }
    ).themeTest;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    };
    const failures: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (document.documentElement.dataset.theme !== `${id}-${mode}`) {
          failures.push(`${id}-${mode}: theme not applied`);
          continue;
        }
        for (const label of ['Combo', 'Destacado']) {
          const badge = document.createElement('span');
          badge.className = `${productStyles['product-card__badge']} ${productStyles['product-card__badge--primary']}`;
          badge.textContent = label;
          document.body.appendChild(badge);
          const style = getComputedStyle(badge);
          const stops = style.backgroundImage.match(/(?:rgba?|color|oklch)\([^()]+\)/g) ?? [];
          if (!style.backgroundImage.startsWith('linear-gradient(') || stops.length !== 2) {
            failures.push(`${id}-${mode} ${label}: unexpected background ${style.backgroundImage}`);
          } else {
            for (const [index, stop] of stops.entries()) {
              const [a, b] = [luminance(style.color), luminance(stop)].sort((a, b) => b - a);
              const ratio = (a + 0.05) / (b + 0.05);
              if (ratio < 4.5)
                failures.push(`${id}-${mode} ${label} endpoint ${index + 1}: ${ratio.toFixed(2)}`);
            }
          }
          badge.remove();
        }
      }
    }
    return failures;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('status and error consumers remain legible on actual surfaces across theme families', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  const failures = await page.evaluate(async () => {
    const { useUIStore, themeCatalog, tenantStyles, productStyles, discountStyles, searchStyles } =
      (
        window as unknown as {
          themeTest: {
            useUIStore: { setState: (state: object) => void };
            themeCatalog: { id: string }[];
            tenantStyles: Record<string, string>;
            productStyles: Record<string, string>;
            discountStyles: Record<string, string>;
            searchStyles: Record<string, string>;
          };
        }
      ).themeTest;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sample = (background: string, overlay?: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1, 1);
      if (overlay) {
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (channels: number[]) =>
      channels.reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    const failures: string[] = [];
    for (const { id } of themeCatalog) {
      for (const mode of ['light', 'dark']) {
        useUIStore.setState({ themeFamily: id, themeMode: mode });
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const surface of ['--color-surface']) {
          const container = document.createElement('div');
          container.style.backgroundColor = `var(${surface})`;
          document.body.appendChild(container);
          for (const className of [
            'app-badge app-badge--info',
            `${tenantStyles['status-badge']} ${tenantStyles['status-badge--healthy']}`,
            `${tenantStyles['status-badge']} ${tenantStyles['status-badge--broken']}`,
            'form-input__error',
            'form-textarea__error',
            'money money--negative',
            productStyles['product-card__stock-alert--error'],
            productStyles['product-card__price'],
            discountStyles['manual-discount__required-mark'],
            'global-search-dropdown__scope global-search-dropdown__scope--active',
            'exact-match__badge',
            `${searchStyles['product-search-page__scope-chip']} ${searchStyles['product-search-page__scope-chip--active']}`,
            searchStyles['exact-match__badge'],
            searchStyles['highlight'],
          ]) {
            if (!className || className.includes('undefined')) {
              failures.push(`${id}-${mode}: missing consumer CSS class`);
              continue;
            }
            const badge = document.createElement('span');
            badge.className = className;
            badge.textContent = 'Status';
            container.appendChild(badge);
            const badgeStyle = getComputedStyle(badge);
            const [a, b] = [
              luminance(sample(badgeStyle.color)),
              luminance(
                sample(getComputedStyle(container).backgroundColor, badgeStyle.backgroundColor)
              ),
            ].sort((a, b) => b - a);
            const ratio = (a + 0.05) / (b + 0.05);
            if (ratio < 4.5)
              failures.push(`${id}-${mode}: ${className} on ${surface}: ${ratio.toFixed(2)}`);
            badge.remove();
          }
          container.remove();
        }
      }
    }
    return failures;
  });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('shared danger buttons use the semantic foreground in both modes', async ({ page }) => {
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<button class="button button--danger">Delete</button>');
  for (const path of [
    'src/styles/base.css',
    'src/styles/themes.css',
    'src/shared/components/ui/primitives/Button/button.css',
  ]) {
    await page.addStyleTag({ content: readFileSync(resolve(frontend, path), 'utf8') });
  }
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  for (const mode of ['light', 'dark']) {
    await page.evaluate((themeMode) => {
      document.documentElement.dataset.theme = `default-${themeMode}`;
    }, mode);
    const button = page.locator('button');
    const check = () =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        const probe = document.createElement('span');
        probe.style.color = 'var(--color-danger-foreground)';
        element.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        const luminance = (value: string) => {
          const channels = value.match(/\d+/g)!.slice(0, 3).map(Number);
          return channels.reduce((sum, channel, index) => {
            const c = channel / 255;
            return (
              sum +
              [0.2126, 0.7152, 0.0722][index] *
                (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
            );
          }, 0);
        };
        const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort(
          (a, b) => b - a
        );
        return { aligned: style.color === expected, ratio: (a + 0.05) / (b + 0.05) };
      });

    await expect.poll(async () => (await check()).aligned).toBe(true);
    await expect.poll(async () => (await check()).ratio).toBeGreaterThanOrEqual(4.5);
    await button.hover();
    await expect.poll(async () => (await check()).ratio).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
  }
});

test('primary fill controls contrast at rest and on hover', async ({ page }) => {
  test.setTimeout(60_000);
  await prepareFixture(page);
  await page.addStyleTag({ content: '* { transition: none !important; }' });
  await page.evaluate(() => {
    const { tableStyles, modalStyles, inventoryStyles, searchStyles } = (
      window as unknown as {
        themeTest: {
          tableStyles: Record<string, string>;
          modalStyles: Record<string, string>;
          inventoryStyles: Record<string, string>;
          searchStyles: Record<string, string>;
        };
      }
    ).themeTest;
    for (const [name, className] of [
      ['button', 'button button--primary'],
      ['table', tableStyles['table-state__action']],
      [
        'modal',
        `${modalStyles['product-search-modal__view-btn']} ${modalStyles['product-search-modal__view-btn--active']}`,
      ],
      ['inventory', inventoryStyles['inventory-history-toolbar__new-btn']],
      ['global-search', 'global-search-dropdown__scope global-search-dropdown__scope--active'],
      [
        'product-search',
        `${searchStyles['product-search-page__scope-chip']} ${searchStyles['product-search-page__scope-chip--active']}`,
      ],
    ]) {
      const button = document.createElement('button');
      button.dataset.fixture = name;
      button.className = className;
      button.textContent = 'Action';
      document.body.appendChild(button);
    }
  });
  const failures: string[] = [];
  const families = await page.evaluate(() =>
    (
      window as unknown as { themeTest: { themeCatalog: { id: string }[] } }
    ).themeTest.themeCatalog.map((item) => item.id)
  );
  for (const family of families) {
    for (const mode of ['light', 'dark']) {
      await page.evaluate(
        ({ family, mode }) => {
          const { useUIStore } = (
            window as unknown as {
              themeTest: { useUIStore: { setState: (state: object) => void } };
            }
          ).themeTest;
          useUIStore.setState({ themeFamily: family, themeMode: mode });
        },
        { family, mode }
      );
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        `${family}-${mode}`
      );
      if (family === 'custom')
        await page.waitForSelector('#pos-custom-theme-vars', { state: 'attached' });
      for (const name of [
        'button',
        'table',
        'modal',
        'inventory',
        'global-search',
        'product-search',
      ]) {
        const target = page.locator(`[data-fixture="${name}"]`);
        for (const state of ['rest', 'hover']) {
          if (state === 'hover') await target.hover();
          else await page.mouse.move(1200, 700);
          const contrast = await target.evaluate((button) => {
            const style = getComputedStyle(button);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            const luminance = (value: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = value;
              ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .reduce((sum, channel, index) => {
                  const c = channel / 255;
                  return (
                    sum +
                    [0.2126, 0.7152, 0.0722][index] *
                      (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
                  );
                }, 0);
            };
            const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort(
              (a, b) => b - a
            );
            return (a + 0.05) / (b + 0.05);
          });
          if (contrast < 4.5)
            failures.push(`${family}-${mode} ${name} ${state}: ${contrast.toFixed(2)}`);
        }
      }
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
