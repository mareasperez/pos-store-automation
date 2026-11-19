import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startThemeTestServer } from './theme-test-server';

const frontend = resolve(process.cwd(), '..', 'frontend');
let server: { close: () => Promise<void>; resolvedUrls: { local: string[] } | null };
let origin: string;

test.beforeAll(async () => {
  const tailwindUrl = pathToFileURL(
    resolve(frontend, 'node_modules/@tailwindcss/vite/dist/index.mjs')
  ).href;
  const { default: tailwindcss } = await import(tailwindUrl);
  server = await startThemeTestServer({
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
            import '/src/shared/components/ui/layout/Header/header.css';
            import '/src/shared/components/ui/layout/Footer/footer.css';
            import '/src/shared/components/ui/inputs/FileDropZone/file-drop-zone.css';
            import '/src/shared/components/layouts/StandardListLayout/standard-list-layout.css';
            import '/src/styles/forms.css';
            import '/src/index.css';
            import users from '/src/features/organization/screens/UsersList.module.css';
            import tenants from '/src/features/organization/screens/TenantsList.module.css';
            import tenantSummary from '/src/features/organization/components/TenantSummaryModal/TenantSummaryModal.module.css';
            import blocking from '/src/features/organization/components/TenantSummaryModal/TenantBlockingRecordsPanel.module.css';
            import platformUser from '/src/features/organization/components/PlatformUserDetailsDrawer.module.css';
            import inventoryTable from '/src/features/inventory/styles/inventory-table.module.css';
            import sku from '/src/features/inventory/styles/sku-selector.module.css';
            import notes from '/src/features/sales/screens/FinancialMovements/NotesPages.module.css';
            import credit from '/src/features/sales/components/CustomerCreditPanel/CustomerCreditPanel.module.css';
            import productEntry from '/src/features/sales/components/ProductEntry/ProductEntry.module.css';
            import suggestions from '/src/features/sales/components/ProductEntry/ProductSuggestionsDropdown.module.css';
            import ticket from '/src/features/sales/components/TicketPreview/ticket-preview.module.css';
            import totals from '/src/features/sales/components/SellTotals/SellTotals.module.css';
            import lookup from '/src/features/catalog/components/ProductLookup/product-lookup.module.css';
            import dashboard from '/src/features/catalog/screens/Dashboard/dashboard-page.module.css';
            import productForm from '/src/features/catalog/components/ProductForm/product-form.module.css';
            import productEdit from '/src/features/catalog/screens/ProductEdit/product-edit-page.module.css';
            import permission from '/src/features/admin/screens/PermissionManager/PermissionMatrix.module.css';
            import permissionPage from '/src/features/admin/screens/PermissionManager/PermissionManagerPage.module.css';
            import reports from '/src/features/reports/screens/reports-page.module.css';
            import returnPage from '/src/features/returns/screens/returns-page.module.css';
            import returnReport from '/src/features/reports/extensions/returns-voids/returns-voids.module.css';
            import tenantStyles from '/src/features/organization/components/TenantDetailsDrawer.module.css';
            import productStyles from '/src/features/catalog/components/ProductCard/product-card.module.css';
            import discountStyles from '/src/features/sales/components/ManualSaleDiscountControl/manual-sale-discount-control.module.css';
            import searchStyles from '/src/features/catalog/screens/ProductSearch/product-search-page.module.css';
            import tableStyles from '/src/shared/components/ui/table/TableState.module.css';
            import modalStyles from '/src/features/catalog/components/ProductSearchModal/product-search-modal.module.css';
            import inventoryStyles from '/src/features/inventory/styles/inventory-transaction.module.css';
            import orderStyles from '/src/features/sales/components/OrderContext/OrderContext.module.css';
            import { Select } from '/src/shared/components/ui/inputs/Select/Select.tsx';
            import { StatusBadge } from '/src/shared/components/ui/table/Table.tsx';
            import { ExpandableTable } from '/src/shared/components/ui/table/ExpandableTable.tsx';
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { useTheme } from '/src/shared/hooks/useTheme.ts';
            import { useUIStore, DEFAULT_THEME_CUSTOM_CONFIG } from '/src/shared/stores/useUIStore.ts';
            import { themeCatalog } from '/src/features/admin/screens/SettingsPage/themeCatalog.ts';
            function Harness() { useTheme(); return null; }
            useUIStore.setState({themeCustomConfig: DEFAULT_THEME_CUSTOM_CONFIG});
            function mountTable() {
              const container = document.createElement('div');
              document.body.appendChild(container);
              const statuses = ['completed', 'active', 'paid', 'pending', 'partial', 'cancelled', 'inactive', 'returned', 'draft'];
              createRoot(container).render(React.createElement(ExpandableTable, {
                data: [{ id: 1 }], getRowKey: (item) => item.id,
                columns: statuses.map((status) => ({
                  id: status, header: status,
                  accessor: () => React.createElement(StatusBadge, { status })
                })),
                renderExpandedContent: () => React.createElement('p', null, 'Detalle'),
                expandLabel: () => 'Ver detalle'
              }));
            }
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
            const batchStyles = {users, tenants, tenantSummary, blocking, platformUser, inventoryTable, sku, notes, credit, productEntry, suggestions, ticket, totals, lookup, dashboard, productForm, productEdit, permission, permissionPage, reports, returnPage, returnReport};
            async function mountBatchReact() {
              const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
              const { CustomerList } = await import('/src/features/customers/components/CustomerList/CustomerList.tsx');
              const { CustomerCreditPanel } = await import('/src/features/sales/components/CustomerCreditPanel/CustomerCreditPanel.tsx');
              const { SalesKpis } = await import('/src/features/reports/sales/components/SalesKpis.tsx');
              const { Badge } = await import('/src/shared/components/ui/primitives/Badge/Badge.tsx');
              const { ProductCard } = await import('/src/features/catalog/components/ProductCard/ProductCard.tsx');
              const { PaymentReconciliationTable } = await import('/src/features/shifts/components/PaymentReconciliationTable/PaymentReconciliationTable.tsx');
              const { useAppStore } = await import('/src/shared/stores/useAppStore.ts');
              useAppStore.setState({activeTenantId: null});
              const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
              const container = document.createElement('section');
              container.dataset.batchReact = 'true';
              container.style.background = 'var(--color-surface)';
              document.body.appendChild(container);
              const customer = {id: 2, name:'Cliente', status:'ACTIVE', creditActive:true, creditLimit:100, phone:'', email:''};
              createRoot(container).render(React.createElement(QueryClientProvider, {client},
                React.createElement(CustomerList, {customers:[customer], onEdit:()=>{}, onDelete:()=>{}}),
                React.createElement(CustomerCreditPanel, {customer, totalOutstanding:20, isLoading:false, hasError:false}),
                React.createElement(CustomerCreditPanel, {customer, totalOutstanding:100, isLoading:false, hasError:false}),
                React.createElement(SalesKpis, {current:{totalAmount:120,tickets:2,averageTicket:60}, previous:{totalAmount:100,tickets:3,averageTicket:60}, previousLabel:'Anterior'}),
                React.createElement(ProductCard, {item:{key:'service',id:1,name:'Servicio',price:10,stock:0,sellableType:'SERVICE',originalProduct:{id:1,name:'Servicio',active:true},isUnit:false,isBasePresentation:true,presentationId:1,presentationName:'Unidad',conversionFactor:1}}),
                React.createElement('section', {'data-batch-shift':true},
                  React.createElement(PaymentReconciliationTable, {
                    paymentMethods:[1,2,3].map(id=>({id,code:'CASH'+id,name:'Efectivo',active:true,currency:'NIO',requiresShiftCount:true})),
                    countedAmounts:{1:'10',2:'12',3:'8'}, validAmounts:{1:10,2:12,3:8},
                    expectedAmounts:{1:10,2:10,3:10}, errors:{}, onChange:()=>{}, onBlur:()=>{},
                    currencies:[{code:'NIO',symbol:'C$',decimals:2}],locale:'es-NI'
                  })
                ),
                ...['success','secondary','info','primary','warning','danger'].map(variant =>
                  React.createElement(Badge, {key:variant, variant, onClick:()=>{}}, variant))
              ));
            }
            window.themeTest = {useUIStore, themeCatalog, tenantStyles, productStyles, discountStyles, searchStyles, tableStyles, modalStyles, inventoryStyles, mountSelect, mountImport, mountUserForm, mountTable, batchStyles, mountBatchReact};
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
  try {
    origin = server.resolvedUrls!.local[0].replace(/\/$/, '');
  } catch (error) {
    await server.close();
    throw error;
  }
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

async function tableTextMeasurements(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (value: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const channels = [...ctx.getImageData(0, 0, 1, 1).data];
      return [...channels.slice(0, 3), channels[3] / 255];
    };
    const over = (foreground: number[], background: number[]) =>
      background
        .slice(0, 3)
        .map((channel, index) => foreground[index] * foreground[3] + channel * (1 - foreground[3]));
    const luminance = (channels: number[]) =>
      channels.reduce((sum, channel, index) => {
        const c = channel / 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][index] *
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    return elements.map((element) => {
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        ancestors.unshift(node);
      }
      let background = [255, 255, 255];
      let opacity = 1;
      for (const ancestor of ancestors) {
        const style = getComputedStyle(ancestor);
        if (style.backgroundImage !== 'none') {
          throw new Error(`Unmeasured background image: ${style.backgroundImage}`);
        }
        background = over(rgba(style.backgroundColor), background);
        const alpha = Number(style.opacity);
        if (alpha !== 1 && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          throw new Error('Opacity on a painted background requires group compositing');
        }
        opacity *= alpha;
      }
      const foreground = rgba(getComputedStyle(element).color);
      if (getComputedStyle(element).webkitTextFillColor === 'rgba(0, 0, 0, 0)') {
        throw new Error('Transparent text fill requires measuring its painted text image');
      }
      foreground[3] *= opacity;
      const painted = over(foreground, background);
      const [a, b] = [luminance(painted), luminance(background)].sort((x, y) => y - x);
      return {
        name: element.getAttribute('data-status') ?? element.className,
        ratio: (a + 0.05) / (b + 0.05),
        foreground: painted,
        background,
        opacity,
      };
    });
  });
}

test('coordinated component text pairs retain contrast in their source contexts', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await prepareFixture(page);
  await page.evaluate(() => {
    const styles = (
      window as unknown as {
        themeTest: { batchStyles: Record<string, Record<string, string>> };
      }
    ).themeTest.batchStyles;
    const context = (owner: string, key: string) => {
      const value = styles[owner]?.[key];
      if (!value) throw new Error(`Missing component style: ${owner}.${key}`);
      return value;
    };
    const cases = [
      ['tenant menu', 'tenants', 'text-danger', '', ''],
      ['tenant count', 'tenantSummary', 'count-card__count', '', ''],
      ['tenant transactional badge', 'tenantSummary', 'badge-transactional', '', ''],
      ['tenant blocking title', 'blocking', 'blocking-title', 'blocking', 'blocking-panel'],
      ['tenant blocking count', 'blocking', 'blocking-item__count', 'blocking', 'blocking-panel'],
      ['platform edit', 'platformUser', 'edit-profile-btn', '', ''],
      ['SKU clear', 'sku', 'sku-selector__clear-btn', 'sku', 'sku-selector__selected'],
      ['inventory status', 'inventoryTable', 'inventory-table__badge', '', ''],
      ['inventory delete', 'inventoryTable', 'inventory-table__delete-btn', '', ''],
      [
        'notes guide',
        'notes',
        'settlement-documents-page__guide-link',
        'notes',
        'settlement-documents-page__guide',
      ],
      [
        'notes error',
        'notes',
        'settlement-documents-page__error',
        'notes',
        'settlement-documents-page__modal',
      ],
      ['ticket validation', 'ticket', 'ticket-preview__qty-error', '', ''],
      ['generic product', 'productEntry', 'product-entry__generic-btn', '', ''],
      ['stock suggestion', 'suggestions', 'suggestion-item__stock--none', '', ''],
      ['product price', 'lookup', 'product-lookup__price', '', ''],
      ['dashboard rank', 'dashboard', 'dashboard-page__top-products-rank', '', ''],
      ['dashboard metric', 'dashboard', 'dashboard-page__top-products-metric', '', ''],
      ['product edit error', 'productEdit', 'product-edit-page__error', '', ''],
      ['presentation override', 'productForm', 'product-form__override-btn--active', '', ''],
      ['margin override', 'productForm', 'product-form__override-btn--margin', '', ''],
      ['permission resource', 'permission', 'resource-toggle', 'permission', 'resource-row'],
      ['permission active tab', 'permissionPage', 'tab', '', ''],
      ['report breadcrumb', 'reports', 'reports-detail__breadcrumb-link', '', ''],
      ['return step', 'returnPage', 'returns-page__step--active', '', ''],
      ['return error', 'returnPage', 'returns-page__error', '', ''],
      ['report return badge', 'returnReport', 'returnBadge', '', ''],
      ['report error', 'returnReport', 'error', '', ''],
    ];
    const root = document.createElement('section');
    root.dataset.batchCss = 'true';
    root.style.background = 'var(--color-surface)';
    root.style.padding = '16px';
    const controls = new Set([
      'platform edit',
      'SKU clear',
      'inventory delete',
      'generic product',
      'presentation override',
      'margin override',
      'permission resource',
      'permission active tab',
    ]);
    for (const [name, owner, key, parentOwner, parentKey] of cases) {
      const host = document.createElement('div');
      if (parentOwner) host.className = context(parentOwner, parentKey);
      const element = document.createElement(
        controls.has(name)
          ? 'button'
          : name.endsWith('link') || name === 'report breadcrumb'
            ? 'a'
            : 'span'
      );
      element.textContent = name;
      element.dataset.batchPaint = name;
      element.className = context(owner, key);
      if (name === 'presentation override' || name === 'margin override') {
        element.classList.add(context('productForm', 'product-form__override-btn'));
      }
      if (name === 'return step')
        element.classList.add(context('returnPage', 'returns-page__step'));
      if (name === 'permission active tab')
        element.classList.add(context('permissionPage', 'active'));
      if (name === 'dashboard metric') {
        const label = document.createElement('span');
        label.textContent = '12%';
        element.replaceChildren(label);
        delete element.dataset.batchPaint;
        label.dataset.batchPaint = name;
      }
      host.appendChild(element);
      root.appendChild(host);
    }
    root.insertAdjacentHTML(
      'beforeend',
      `
      <div class="app-table__body"><div class="app-table__row" data-batch-hover="user row">
        <span class="${context('users', 'user-name-cell')}" data-batch-paint="user name">Cliente</span>
      </div></div>
      <div class="footer">
        <a class="footer-link" data-batch-paint="footer link">Autor</a>
        <button class="footer-toggle" aria-label="Detalles" data-batch-paint="footer toggle">⌄</button>
      </div>
      <div style="background:var(--color-bg)"><header class="header">
        <a class="header__brand" data-batch-paint="header brand">POS Store</a>
      </header></div>
      <div class="file-drop-zone"><p class="file-drop-zone__error" data-batch-paint="file error">Archivo inválido</p></div>
      <p class="standard-list-error" data-batch-paint="list error">Error</p>
      <p class="form-field__error" data-batch-paint="form error">Requerido</p>
      <h1 class="app-page-title" data-batch-paint="page title">Productos</h1>
      <p class="text-danger" data-batch-paint="danger utility">Requerido</p>`
    );
    document.body.appendChild(root);
  });
  const families = await page.evaluate(() =>
    (
      window as unknown as { themeTest: { themeCatalog: { id: string }[] } }
    ).themeTest.themeCatalog.map(({ id }) => id)
  );
  const measurements: {
    theme: string;
    width: number;
    state: string;
    name: string;
    ratio: number;
  }[] = [];
  const sample = async (theme: string, width: number, state: string, selector: string) => {
    await page.evaluate(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        document.body.getBoundingClientRect();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
        if (!animations.length) return;
        await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
      }
      throw new Error('Batch paint did not settle');
    });
    const values = await tableTextMeasurements(page, selector);
    expect(values.length).toBeGreaterThan(0);
    measurements.push(...values.map((value) => ({ theme, width, state, ...value })));
  };
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const family of families) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(
          ({ family, mode }) =>
            (
              window as unknown as {
                themeTest: { useUIStore: { setState: (state: object) => void } };
              }
            ).themeTest.useUIStore.setState({ themeFamily: family, themeMode: mode }),
          { family, mode }
        );
        await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
        await page.mouse.move(0, 0);
        await sample(`${family}-${mode}`, width, 'rest', '[data-batch-paint]');
        for (const name of [
          'user name',
          'footer link',
          'footer toggle',
          'generic product',
          'inventory delete',
          'permission active tab',
          'report breadcrumb',
          'danger utility',
        ]) {
          const selector = `[data-batch-paint="${name}"]`;
          await page.locator(selector).hover();
          await sample(`${family}-${mode}`, width, 'hover', selector);
        }
      }
    }
  }
  await test.info().attach('component-batch-computed-paint', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  expect(measurements.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
});

test('coordinated React badge credit and report states retain readable text', async ({ page }) => {
  test.setTimeout(180_000);
  await prepareFixture(page);
  await page.evaluate(() =>
    (
      window as unknown as { themeTest: { mountBatchReact: () => Promise<void> } }
    ).themeTest.mountBatchReact()
  );
  await expect(page.locator('[data-batch-react] .app-badge')).toHaveCount(6);
  const families = await page.evaluate(() =>
    (
      window as unknown as { themeTest: { themeCatalog: { id: string }[] } }
    ).themeTest.themeCatalog.map(({ id }) => id)
  );
  const failures: { theme: string; name: string; ratio: number }[] = [];
  for (const family of families) {
    for (const mode of ['light', 'dark']) {
      await page.evaluate(
        ({ family, mode }) =>
          (
            window as unknown as {
              themeTest: { useUIStore: { setState: (state: object) => void } };
            }
          ).themeTest.useUIStore.setState({ themeFamily: family, themeMode: mode }),
        { family, mode }
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined))
        );
      });
      for (const selector of [
        '[data-batch-react] .app-badge',
        '[data-batch-react] [class*="product-card__badge--service"]',
        '[data-batch-react] [class*="credit-panel__value--"]',
        '[data-batch-react] .text-xs.font-semibold',
        '[data-batch-react] .app-table__cell:nth-child(4) > span',
        '[data-batch-shift] .w-fit',
      ]) {
        const values = await tableTextMeasurements(page, selector);
        expect(values.length).toBeGreaterThan(0);
        failures.push(
          ...values
            .filter(({ ratio }) => ratio < 4.5)
            .map((value) => ({ theme: `${family}-${mode}`, ...value }))
        );
      }
      for (const badge of await page.locator('[data-batch-react] .app-badge').all()) {
        await badge.hover();
        await expect(badge).toHaveCSS('filter', 'none');
        const [value] = await tableTextMeasurements(
          page,
          `[data-batch-react] .app-badge--${await badge.textContent()}`
        );
        failures.push(
          ...[value]
            .filter(({ ratio }) => ratio < 4.5)
            .map((measurement) => ({ theme: `${family}-${mode} hover`, ...measurement }))
        );
      }
    }
  }
  expect(failures).toEqual([]);
});

test('search scope hover and product card text use readable theme pairs', async ({ page }) => {
  test.setTimeout(120_000);
  await prepareFixture(page);
  await page.evaluate(() => {
    const { productStyles, searchStyles } = (
      window as unknown as {
        themeTest: { productStyles: Record<string, string>; searchStyles: Record<string, string> };
      }
    ).themeTest;
    const root = document.createElement('div');
    root.style.background = 'var(--color-surface)';
    root.innerHTML = `
      <button class="global-search-dropdown__scope" data-paint="global-scope">Productos</button>
      <button class="${searchStyles['product-search-page__scope-chip']}" data-paint="page-scope">Productos</button>
      <div class="${productStyles['product-card']}">
        <span class="${productStyles['product-card__unit-badge']}" data-paint="unit">Unidad</span>
        <span class="${productStyles['product-card__stock-alert--notice']}" data-paint="notice">No hay en esta bodega</span>
        <span class="${productStyles['product-card__badge']} ${productStyles['product-card__badge--blocked']}" data-paint="blocked">Bloqueado</span>
      </div>`;
    document.body.appendChild(root);
  });
  const families = await page.evaluate(() =>
    (
      window as unknown as { themeTest: { themeCatalog: { id: string }[] } }
    ).themeTest.themeCatalog.map(({ id }) => id)
  );
  const measurements: { theme: string; state: string; name: string; ratio: number }[] = [];
  const settlePaint = () =>
    page.evaluate(async () => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        document.body.getBoundingClientRect();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const animations = document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
        if (!animations.length) return;
        await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
      }
      throw new Error('Component paint did not settle');
    });
  for (const family of families) {
    for (const mode of ['light', 'dark']) {
      await page.evaluate(
        ({ family, mode }) =>
          (
            window as unknown as {
              themeTest: { useUIStore: { setState: (state: object) => void } };
            }
          ).themeTest.useUIStore.setState({ themeFamily: family, themeMode: mode }),
        { family, mode }
      );
      await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
      for (const name of ['global-scope', 'page-scope']) {
        await page.locator(`[data-paint="${name}"]`).hover();
        await settlePaint();
        const [value] = await tableTextMeasurements(page, `[data-paint="${name}"]`);
        measurements.push({ theme: `${family}-${mode}`, state: 'hover', name, ratio: value.ratio });
      }
      for (const { state, activate } of [
        { state: 'rest', activate: () => page.mouse.move(0, 0) },
        { state: 'hover', activate: () => page.locator('[data-paint="notice"]').hover() },
      ]) {
        await activate();
        await settlePaint();
        for (const name of ['unit', 'notice', 'blocked']) {
          const [value] = await tableTextMeasurements(page, `[data-paint="${name}"]`);
          measurements.push({ theme: `${family}-${mode}`, state, name, ratio: value.ratio });
        }
      }
    }
  }
  const failures = measurements.filter(({ ratio }) => ratio < 4.5);
  console.log(
    `Component paint: ${measurements.length} checks, ${failures.length} failures, minima ${JSON.stringify(
      Object.fromEntries(
        [...new Set(measurements.map(({ name }) => name))].map((name) => [
          name,
          Math.min(
            ...measurements.filter((entry) => entry.name === name).map(({ ratio }) => ratio)
          ),
        ])
      )
    )}`
  );
  expect(failures).toEqual([]);
});

for (const { consumer, selector } of [
  { consumer: 'badges', selector: '.app-status-badge' },
  { consumer: 'expansion control', selector: '.expand-label' },
]) {
  test(`shared table ${consumer} text contrast on rendered backgrounds`, async ({ page }) => {
    test.setTimeout(120_000);
    await prepareFixture(page);
    await page.evaluate(() => {
      (window as unknown as { themeTest: { mountTable: () => void } }).themeTest.mountTable();
    });
    const button = page.getByRole('button', { name: 'Expand row', exact: true });
    await expect(button).toBeVisible();
    const families = await page.evaluate(() =>
      (
        window as unknown as { themeTest: { themeCatalog: { id: string }[] } }
      ).themeTest.themeCatalog.map(({ id }) => id)
    );
    const measurements: {
      theme: string;
      width: number;
      state: string;
      name: string;
      ratio: number;
    }[] = [];
    for (const width of [1280, 600]) {
      await page.setViewportSize({ width, height: 900 });
      for (const family of families) {
        for (const mode of ['light', 'dark']) {
          await page.evaluate(
            ({ family, mode }) => {
              (
                window as unknown as {
                  themeTest: { useUIStore: { setState: (state: object) => void } };
                }
              ).themeTest.useUIStore.setState({ themeFamily: family, themeMode: mode });
            },
            { family, mode }
          );
          await expect(page.locator('html')).toHaveAttribute('data-theme', `${family}-${mode}`);
          for (const { state, activate } of [
            { state: 'rest', activate: () => page.mouse.move(0, 0) },
            {
              state: 'row-hover',
              activate: () => page.locator('.app-status-badge--completed').hover(),
            },
            { state: 'control-hover', activate: () => button.hover() },
          ]) {
            await activate();
            await page.evaluate(async () => {
              // Inherited color transitions can retarget descendants after an ancestor finishes.
              const deadline = performance.now() + 5000;
              while (performance.now() < deadline) {
                document.body.getBoundingClientRect();
                await new Promise(requestAnimationFrame);
                await new Promise(requestAnimationFrame);
                const animations = document
                  .getAnimations()
                  .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
                if (!animations.length) return;
                await Promise.all(
                  animations.map((animation) => animation.finished.catch(() => undefined))
                );
              }
              throw new Error('Table paint did not settle');
            });
            const values = await tableTextMeasurements(page, selector);
            measurements.push(
              ...values.map((value) => ({
                theme: `${family}-${mode}`,
                width,
                state,
                ...value,
              }))
            );
          }
        }
      }
    }
    await test.info().attach('table-contrast-measurements', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
    const failures = measurements.filter(({ ratio }) => ratio < 4.5);
    const worst = measurements.reduce((a, b) => (a.ratio < b.ratio ? a : b));
    console.log(
      `Table ${consumer}: ${measurements.length} checks, ${failures.length} failures, worst ${JSON.stringify(worst)}`
    );
    const minima = Object.fromEntries(
      [...new Set(measurements.map(({ name }) => name))].map((name) => [
        name,
        Math.min(...measurements.filter((value) => value.name === name).map(({ ratio }) => ratio)),
      ])
    );
    console.log(`Table ${consumer} minimum ratios: ${JSON.stringify(minima)}`);
    expect(
      failures.map(
        ({ theme, width, state, name, ratio }) =>
          `${theme} ${width}px ${state} ${name}: ${ratio.toFixed(3)}`
      )
    ).toEqual([]);
    await button.click();
    await expect(page.getByText('Detalle', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse row', exact: true }).click();
    await expect(page.getByText('Detalle', { exact: true })).toHaveCount(0);
  });
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
