import { randomUUID } from 'node:crypto';
import { type Locator, type Page, type Response } from '@playwright/test';
import { config } from '@config';
import { expect, serialDescribe, test } from '@fixtures';
import { buildApiHeaders } from '../../utils/apiHeaders';

/* eslint playwright/expect-expect: off -- exerciseExpense and preflight contain the real assertions. */

interface Expense {
  id: number;
  expenseNumber: string;
  branchId: number;
  categoryId: number;
  paymentMethodId: number;
  description: string;
  beneficiary: string | null;
  notes: string | null;
  amount: number;
  currencyCode: string;
  expenseDate: string;
  paidAt: string;
  createdAt: string;
  createdByUserId: number;
  status: 'POSTED' | 'VOIDED';
  shiftId: number | null;
  voidedAt: string | null;
  voidedByUserId: number | null;
  voidReason: string | null;
}

interface Method {
  id: number;
  name: string;
  active: boolean;
  requiresShiftCount: boolean;
  currency: string;
}

interface Shift {
  id: number;
  userId: number;
  status: string;
  startTime: string;
  cashMovements: {
    id: number;
    type: string;
    amount: number;
    paymentMethodId: number;
    expenseId: number | null;
    expenseStatus: string | null;
    expenseVoidReason: string | null;
  }[];
  paymentReconciliations: { paymentMethodId: number; expectedAmount: number }[];
  salesPayments?: {
    id: number;
    saleId: number;
    paymentMethodId: number;
    amount: number;
    currency: string;
  }[];
}

interface ExpenseReport {
  fromExpenseDate: string;
  toExpenseDate: string;
  rows: Expense[];
  totalsByCurrency: { currencyCode: string; totalAmount: number; expenseCount: number }[];
}

interface ExistingReports {
  summary: { tickets: number; totalAmount: number; averageTicket: number };
  payments: { paymentMethodId: number; totalAmount: number; paymentsCount: number }[];
  settlement: {
    tickets: number;
    totalAmount: number;
    paidUpfront: number;
    financedAmount: number;
    sales: { saleId: number; payments: { methodName: string; amount: number }[] }[];
  };
}

function isConfiguredApiOrigin(origin: string): boolean {
  const actual = new URL(origin);
  const configured = new URL(config.apiRoot);
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const sameHost =
    actual.hostname === configured.hostname ||
    (loopbackHosts.has(actual.hostname) && loopbackHosts.has(configured.hostname));
  return sameHost && actual.protocol === configured.protocol && actual.port === configured.port;
}

function isConfiguredResponseOrigin(origin: string): boolean {
  // UI API calls may use the configured frontend's same-origin Vite proxy.
  return isConfiguredApiOrigin(origin) || origin === new URL(config.baseUrl).origin;
}

async function existingReports(page: Page, range: string): Promise<ExistingReports> {
  const [summary, payments, settlement] = await Promise.all([
    api<ExistingReports['summary']>(page, `/reports/sales-summary?${range}`),
    api<ExistingReports['payments']>(page, `/reports/payment-methods?${range}`),
    api<ExistingReports['settlement']>(page, `/reports/sales-by-settlement?${range}`),
  ]);
  return { summary, payments, settlement };
}

async function expenseReport(
  page: Page,
  date: string,
  categoryId: number,
  methodId: number,
  includeHistory = false
): Promise<ExpenseReport> {
  const params = new URLSearchParams({
    fromExpenseDate: date,
    toExpenseDate: date,
    categoryId: String(categoryId),
    paymentMethodId: String(methodId),
    includeHistory: String(includeHistory),
  });
  const report = await api<ExpenseReport>(page, `/reports/expenses?${params}`);
  expect(report.fromExpenseDate).toBe(date);
  expect(report.toExpenseDate).toBe(date);
  return report;
}

function currencyTotal(report: ExpenseReport, currency: string) {
  const total = report.totalsByCurrency.find((item) => item.currencyCode === currency);
  return { amount: Number(total?.totalAmount ?? 0), count: total?.expenseCount ?? 0 };
}

function persistedMicroseconds(timestamp: string): bigint {
  // PostgreSQL TIMESTAMPTZ rounds Java Instant's nanoseconds to microseconds.
  const [seconds, fraction = ''] = timestamp.replace(/Z$/, '').split('.');
  return (
    BigInt(Date.parse(`${seconds}Z`)) * 1000n +
    BigInt(`${fraction}000000`.slice(0, 6)) +
    (Number(fraction[6] ?? '0') >= 5 ? 1n : 0n)
  );
}

async function api<T>(page: Page, endpoint: string, reason?: string): Promise<T> {
  // Only GET, or domain-supported void of an explicitly owned expense; never DELETE.
  const response = await page.request.fetch(`${config.apiRoot}${endpoint}`, {
    method: reason === undefined ? 'GET' : 'POST',
    headers: await buildApiHeaders(page),
    ...(reason === undefined ? {} : { data: { reason } }),
    maxRedirects: 0,
  });
  expect(
    response.ok(),
    `BLOCKED/FAILED: ${endpoint} returned ${response.status()}; check permissions/session/configuration`
  ).toBe(true);
  if (response.status() === 204) return null as T;
  return (await response.json()) as T;
}

async function preflight(page: Page): Promise<string> {
  const tenantId = config.tenantId;
  const appOrigin = new URL(config.baseUrl).origin;
  const apiRoot = config.apiRoot.replace(/\/+$/, '');
  const apiOrigin = new URL(apiRoot).origin;
  expect(
    tenantId,
    'BLOCKED: configure the existing E2E test tenant; never infer or invent one'
  ).toBeTruthy();

  const state = await page.context().storageState();
  expect(
    state.origins.every((origin) => origin.origin === appOrigin),
    'BLOCKED: saved test session must belong only to the configured UI origin'
  ).toBe(true);
  const store = state.origins
    .find((origin) => origin.origin === appOrigin)
    ?.localStorage.find((item) => item.name === 'pos_app_store');
  const saved = store ? (JSON.parse(store.value) as { state: { activeTenantId: string } }) : null;
  expect(
    saved?.state.activeTenantId,
    'BLOCKED: saved session tenant must equal the configured E2E test tenant'
  ).toBe(tenantId);
  await buildApiHeaders(page);
  const runtime = await page.request.get(`${config.baseUrl}/config/app-config.json`, {
    maxRedirects: 0,
  });
  expect(runtime.ok(), 'BLOCKED: configured UI runtime config is unavailable').toBe(true);
  const runtimeConfig = (await runtime.json()) as {
    apiUrl: string;
    defaults?: { timeZone?: string };
  };
  const runtimeApi = new URL(runtimeConfig.apiUrl, config.baseUrl);
  const runtimeApiPath = runtimeApi.pathname.replace(/\/+$/, '');
  const configuredApiPaths = [
    '',
    new URL(config.apiUrl).pathname.replace(/\/+$/, ''),
    new URL(config.apiRoot).pathname.replace(/\/+$/, ''),
  ];
  expect(
    isConfiguredApiOrigin(runtimeApi.origin) && configuredApiPaths.includes(runtimeApiPath),
    'BLOCKED: runtime API must match the configured E2E API host and path'
  ).toBe(true);
  const allowedOrigins = [appOrigin, apiOrigin, runtimeApi.origin];
  expect(
    state.cookies.every((cookie) =>
      allowedOrigins.some(
        (origin) => new URL(origin).hostname === cookie.domain.replace(/^\./, '').toLowerCase()
      )
    ),
    'BLOCKED: saved test session contains cookies outside the configured UI/API hosts'
  ).toBe(true);
  await page.context().route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    return allowedOrigins.includes(origin) ? route.continue() : route.abort('blockedbyclient');
  });
  await page.context().routeWebSocket('**/*', (socket) => socket.close());
  const actor = await api<{ permissions: string[] }>(page, '/me');
  for (const permission of ['expenses:view', 'expenses:create', 'expenses:void', 'reports:view']) {
    expect(
      actor.permissions,
      `BLOCKED: supplied user needs ${permission} before any expense is created`
    ).toContain(permission);
  }
  if (test.info().title.startsWith('counted')) {
    expect(
      actor.permissions,
      'BLOCKED: counted detail/void reads require shifts:view_all'
    ).toContain('shifts:view_all');
  }
  await page.goto('/expenses?lng=es', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Gastos operativos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar gasto', exact: true })).toBeVisible();
  const settings = await api<{ timeZone?: string }>(
    page,
    `/tenants/${encodeURIComponent(tenantId)}/settings`
  );
  const timeZone = settings.timeZone || runtimeConfig.defaults?.timeZone;
  expect(
    timeZone,
    'BLOCKED: tenant/runtime business time zone must be available; never guess report dates'
  ).toBeTruthy();
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  return timeZone!;
}

function responseFor(page: Page, method: string, endpoint: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      isConfiguredResponseOrigin(new URL(response.url()).origin) &&
      new URL(response.url()).pathname ===
        `${new URL(config.apiRoot).pathname.replace(/\/+$/, '')}${endpoint}`,
    { timeout: 10_000 }
  );
}

async function select(page: Page, id: string, label: string): Promise<void> {
  await page.locator(`#${id}`).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

function ownedRow(page: Page, description: string): Locator {
  return page.getByRole('row', { name: `Ver detalle: ${description}`, exact: true });
}

async function outsideClick(page: Page, dialog: Locator): Promise<void> {
  const box = await dialog.boundingBox();
  expect(box, 'Dialog must have a measurable viewport position').not.toBeNull();
  await page.mouse.click(Math.max(1, box!.x - 8), Math.max(1, box!.y - 8));
}

async function exerciseExpense(page: Page, counted: boolean, timeZone: string): Promise<void> {
  const prefix = `E2E-${randomUUID()}`;
  const description = `${prefix}-${counted ? 'counted' : 'non-counted'}`;
  const reason = `${prefix}-audited-void`;
  const categories = await api<{ id: number; name: string; active: boolean }[]>(
    page,
    '/expenses/categories'
  );
  const methods = await api<Method[]>(page, '/payment-methods');
  const category = categories.find((item) => item.active);
  const shiftBefore = await api<Shift | null>(page, '/shifts/active?includeExpectations=true');
  const method = methods.find(
    (item) =>
      item.active &&
      item.requiresShiftCount === counted &&
      (!counted ||
        shiftBefore?.paymentReconciliations.some((entry) => entry.paymentMethodId === item.id))
  );
  expect(category, 'BLOCKED: tenant needs an existing active expense category').toBeTruthy();
  expect(
    method,
    `BLOCKED: tenant needs an existing active ${counted ? 'counted' : 'non-counted'} method`
  ).toBeTruthy();
  if (counted) {
    expect(shiftBefore, 'BLOCKED: actor must already have an eligible open shift').not.toBeNull();
  }
  if (counted && shiftBefore) {
    expect(
      shiftBefore.status,
      'BLOCKED: eligible shift must already be OPEN; never open/close it here'
    ).toBe('OPEN');
    expect(
      shiftBefore.paymentReconciliations.some((item) => item.paymentMethodId === method!.id),
      'BLOCKED: selected counted method needs an existing reconciliation entry'
    ).toBe(true);
  }
  const shiftPaymentsBefore = counted
    ? await api<Shift>(page, `/shifts/${shiftBefore!.id}?includeSalesPayments=true`)
    : null;
  if (shiftPaymentsBefore) {
    expect(
      shiftPaymentsBefore.salesPayments,
      'Shift ledger must expose actual sales-payment entries'
    ).toBeDefined();
  }
  let owned: Expense | undefined;
  let postedMovementIds: number[] | undefined;
  const expensePosts: string[] = [];
  const recordPost = (request: import('@playwright/test').Request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/expenses') {
      expensePosts.push(request.url());
    }
  };
  page.on('request', recordPost);
  try {
    await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuevo gasto', exact: true });
    await expect(dialog.locator('#expense-date')).toBeEditable();
    await expect(dialog.locator('#expense-paid-at')).toBeDisabled();
    const today = await dialog.locator('#expense-date').inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const yesterday = new Date(`${today}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const businessDate = yesterday.toISOString().slice(0, 10);
    await dialog.locator('#expense-date').fill(businessDate);
    await dialog.locator('#expense-description').fill(`${prefix}-cancelled-draft`);
    await outsideClick(page, dialog);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#expense-description')).toHaveValue(`${prefix}-cancelled-draft`);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(expensePosts, 'Cancelling a draft must not POST an expense').toHaveLength(0);

    await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Nuevo gasto', exact: true });
    await expect(dialog.locator('#expense-description')).toHaveValue('');
    await select(page, 'expense-category', category!.name);
    await select(page, 'expense-payment-method', method!.name);
    await dialog.locator('#expense-amount').fill('1.25');
    await dialog.locator('#expense-date').fill(businessDate);
    await dialog.locator('#expense-description').fill(description);
    await dialog.locator('#expense-beneficiary').fill(`${prefix}-beneficiary`);
    await dialog.locator('#expense-notes').fill(`${prefix}-notes`);
    const expenseBefore = await expenseReport(page, businessDate, category!.id, method!.id);
    const paymentDateBefore = await expenseReport(page, today, category!.id, method!.id);
    // Fixed explicit Instant boundaries; sales reports use issuedAt, not expenseDate.
    const reportClock = Date.now();
    const salesRange = new URLSearchParams({
      startDate: new Date(reportClock - 48 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(reportClock + 5 * 60 * 1000).toISOString(),
    }).toString();
    const reportsBefore = await existingReports(page, salesRange);
    const postedAt = Date.now();
    const createdResponse = responseFor(page, 'POST', '/expenses');
    await dialog.getByRole('button', { name: 'Registrar gasto', exact: true }).click();
    const created = await createdResponse;
    expect(
      created.status(),
      'Creation must be real and confirmed; never retry an ambiguous POST'
    ).toBe(201);
    owned = (await created.json()) as Expense;
    console.log(
      `Owned E2E expense ${owned.id} (${owned.expenseNumber}); audit-preserving void only`
    );
    expect(owned.description).toBe(description);
    expect(expensePosts, 'Only one real expense may be submitted; no duplicate/retry').toHaveLength(
      1
    );
    expect(owned.expenseNumber).toMatch(/^exp-\d{3,}$/);
    expect(owned.branchId).toBeGreaterThan(0);
    expect(owned.expenseDate).toBe(businessDate);
    expect(Number(owned.amount)).toBe(1.25);
    expect(owned.currencyCode).toBe(method!.currency);
    expect(owned.paymentMethodId).toBe(method!.id);
    expect(
      created.request().headers()['x-tenant-id'],
      'UI submission must use only the authorized tenant'
    ).toBe(config.tenantId);
    expect(owned.categoryId).toBe(category!.id);
    expect(owned.status).toBe('POSTED');
    expect(owned.shiftId).toBe(counted ? shiftBefore!.id : null);
    expect(Date.parse(owned.paidAt)).toBeGreaterThanOrEqual(postedAt);
    expect(Date.parse(owned.createdAt)).toBeGreaterThanOrEqual(Date.parse(owned.paidAt));
    await expect(dialog).toBeHidden();
    const paidParts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(owned.paidAt));
    const part = (type: string) => paidParts.find((item) => item.type === type)!.value;
    expect(
      `${part('year')}-${part('month')}-${part('day')}`,
      'BLOCKED: tenant date changed while running; rerun only with authorization away from midnight'
    ).toBe(today);
    const expenseAfter = await expenseReport(page, businessDate, category!.id, method!.id);
    expect(expenseAfter.rows.filter((item) => item.id === owned!.id)).toHaveLength(1);
    const beforeTotal = currencyTotal(expenseBefore, owned.currencyCode);
    const afterTotal = currencyTotal(expenseAfter, owned.currencyCode);
    expect(afterTotal.amount, 'Counted OUT must not count as a second expense').toBeCloseTo(
      beforeTotal.amount + 1.25,
      4
    );
    expect(afterTotal.count).toBe(beforeTotal.count + 1);
    expect(
      expenseAfter.totalsByCurrency.filter((item) => item.currencyCode !== owned!.currencyCode)
    ).toEqual(
      expenseBefore.totalsByCurrency.filter((item) => item.currencyCode !== owned!.currencyCode)
    );
    const paymentDateAfter = await expenseReport(page, today, category!.id, method!.id);
    expect(paymentDateAfter.rows.filter((item) => item.id === owned!.id)).toHaveLength(0);
    expect(paymentDateAfter.totalsByCurrency).toEqual(paymentDateBefore.totalsByCurrency);
    expect(
      await existingReports(page, salesRange),
      'Expense/OUT must not change existing sales or posted payment report values'
    ).toEqual(reportsBefore);
    if (shiftPaymentsBefore) {
      const shift = await api<Shift>(page, `/shifts/${shiftBefore!.id}?includeSalesPayments=true`);
      expect(
        shift.salesPayments,
        'Expense OUT must not mutate/add sale_payments ledger entries'
      ).toEqual(shiftPaymentsBefore.salesPayments);
    }

    await page.locator('#expense-from-date').fill(businessDate);
    await page.locator('#expense-to-date').fill(businessDate);
    await select(page, 'expense-category-filter', category!.name);
    const filteredResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          isConfiguredResponseOrigin(url.origin) &&
          url.pathname === `${new URL(config.apiRoot).pathname.replace(/\/+$/, '')}/expenses` &&
          url.searchParams.get('fromExpenseDate') === businessDate &&
          url.searchParams.get('toExpenseDate') === businessDate &&
          url.searchParams.get('categoryId') === String(category!.id) &&
          url.searchParams.get('paymentMethodId') === String(method!.id) &&
          url.searchParams.get('status') === 'POSTED'
        );
      },
      { timeout: 10_000 }
    );
    await select(page, 'expense-payment-method-filter', method!.name);
    const filtered = await filteredResponse;
    expect(filtered.ok()).toBe(true);
    const listed = (await filtered.json()) as { content: Expense[] };
    expect(listed.content.some((item) => item.id === owned!.id)).toBe(true);
    const row = ownedRow(page, description);
    await expect(row).toContainText(owned.expenseNumber);
    await expect(row).toContainText('Registrado');
    await row.click();
    const detail = page.getByRole('dialog', { name: 'Detalle del gasto', exact: true });
    await expect(detail).toContainText(`${prefix}-beneficiary`);
    await expect(detail).toContainText(`${prefix}-notes`);
    await expect(detail).toContainText(businessDate);
    await expect(detail).toContainText(counted ? `#${shiftBefore!.id}` : 'Sin turno asociado');
    await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await row.getByRole('button', { name: `Acciones: ${description}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Ver detalle', exact: true }).click();
    await expect(detail).toContainText(owned.expenseNumber);
    await outsideClick(page, detail);
    await expect(detail).toBeHidden();

    if (!counted) {
      const shift = await api<Shift | null>(page, '/shifts/active?includeExpectations=true');
      expect(shift?.id ?? null, 'Non-counted expense must not create/change the actor shift').toBe(
        shiftBefore?.id ?? null
      );
      if (shift && shiftBefore) {
        expect(shift.cashMovements.filter((item) => item.expenseId === owned!.id)).toHaveLength(0);
        expect(shift.cashMovements).toEqual(shiftBefore.cashMovements);
        expect(shift.paymentReconciliations).toEqual(shiftBefore.paymentReconciliations);
      }
    }
    if (counted && shiftBefore) {
      const shift = await api<Shift>(page, `/shifts/${shiftBefore.id}?includeExpectations=true`);
      expect(shift.userId).toBe(owned.createdByUserId);
      expect(Date.parse(owned.paidAt)).toBeGreaterThanOrEqual(Date.parse(shift.startTime));
      const linked = shift.cashMovements.filter((item) => item.expenseId === owned!.id);
      expect(linked).toHaveLength(1);
      postedMovementIds = shift.cashMovements.map((item) => item.id).sort((a, b) => a - b);
      expect(postedMovementIds).toEqual(
        [...shiftBefore.cashMovements.map((item) => item.id), linked[0].id].sort((a, b) => a - b)
      );
      expect(linked[0]).toMatchObject({
        type: 'OUT',
        paymentMethodId: method!.id,
        expenseStatus: 'POSTED',
      });
      expect(Number(linked[0].amount)).toBe(1.25);
      const expected = (value: Shift) =>
        Number(
          value.paymentReconciliations.find((item) => item.paymentMethodId === method!.id)!
            .expectedAmount
        );
      expect(expected(shift)).toBeCloseTo(expected(shiftBefore) - 1.25, 2);
    }

    await row.getByRole('button', { name: `Acciones: ${description}`, exact: true }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Anular', exact: true }),
      'BLOCKED: supplied user needs expenses:void; no role mutation'
    ).toBeVisible();
    await page.getByRole('menuitem', { name: 'Anular', exact: true }).click();
    const voidDialog = page.getByRole('dialog', { name: 'Anular gasto', exact: true });
    await expect(voidDialog).toContainText(owned.expenseNumber);
    await voidDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect((await api<Expense>(page, `/expenses/${owned.id}`)).status).toBe('POSTED');
    await row.getByRole('button', { name: `Acciones: ${description}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Anular', exact: true }).click();
    await voidDialog.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
    await expect(voidDialog.locator('#expense-void-reason-error')).toBeVisible();
    expect((await api<Expense>(page, `/expenses/${owned.id}`)).status).toBe('POSTED');
    await voidDialog.locator('#expense-void-reason').fill(reason);
    const voidedResponse = responseFor(page, 'POST', `/expenses/${owned.id}/void`);
    await voidDialog.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
    expect((await voidedResponse).ok()).toBe(true);
    await expect(voidDialog).toBeHidden();
    await expect(row).toBeHidden();
    await select(page, 'expense-status-filter', 'Anulado');
    await expect(row).toContainText('Anulado');
    await row.click();
    await expect(detail).toContainText('Auditoría de anulación');
    await expect(detail).toContainText(reason);
    const persisted = await api<Expense>(page, `/expenses/${owned.id}`);
    expect(persisted).toMatchObject({
      id: owned.id,
      expenseNumber: owned.expenseNumber,
      status: 'VOIDED',
      description,
      expenseDate: businessDate,
      paidAt: owned.paidAt,
      createdByUserId: owned.createdByUserId,
      voidReason: reason,
      voidedByUserId: owned.createdByUserId,
    });
    expect(persistedMicroseconds(persisted.createdAt)).toBe(persistedMicroseconds(owned.createdAt));
    expect(Number.isFinite(Date.parse(persisted.voidedAt!))).toBe(true);
    const activeAfterVoid = await expenseReport(page, businessDate, category!.id, method!.id);
    expect(activeAfterVoid.rows.filter((item) => item.id === owned!.id)).toHaveLength(0);
    expect(
      activeAfterVoid.totalsByCurrency,
      'Void restates original expenseDate period, not today as a negative expense'
    ).toEqual(expenseBefore.totalsByCurrency);
    const historyAfterVoid = await expenseReport(
      page,
      businessDate,
      category!.id,
      method!.id,
      true
    );
    const historicalOwned = historyAfterVoid.rows.filter((item) => item.id === owned!.id);
    expect(historicalOwned).toHaveLength(1);
    expect(historicalOwned[0]).toMatchObject({
      status: 'VOIDED',
      expenseDate: businessDate,
      paidAt: owned.paidAt,
    });
    expect(Number(historicalOwned[0].amount)).toBe(1.25);
    expect(
      historyAfterVoid.totalsByCurrency,
      'History retains original amount/status but does not include voided expense in active totals'
    ).toEqual(expenseBefore.totalsByCurrency);
    expect(
      (await expenseReport(page, today, category!.id, method!.id, true)).rows.filter(
        (item) => item.id === owned!.id
      )
    ).toHaveLength(0);
    expect(
      await existingReports(page, salesRange),
      'Expense void must not reverse an existing sale/payment'
    ).toEqual(reportsBefore);
    if (shiftPaymentsBefore) {
      const shift = await api<Shift>(page, `/shifts/${shiftBefore!.id}?includeSalesPayments=true`);
      expect(shift.salesPayments).toEqual(shiftPaymentsBefore.salesPayments);
    }
    await expect(detail).toContainText(`Usuario #${persisted.voidedByUserId}`);
    await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await row.getByRole('button', { name: `Acciones: ${description}`, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Anular', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await select(page, 'expense-status-filter', 'Todos');
    await expect(row).toContainText(owned.expenseNumber);
    if (counted && shiftBefore) {
      const shift = await api<Shift>(page, `/shifts/${shiftBefore.id}?includeExpectations=true`);
      expect(shift.status).toBe('OPEN');
      expect(
        shift.cashMovements.map((item) => item.id).sort((a, b) => a - b),
        'Void must retain the exact movement set, never insert a compensating IN'
      ).toEqual(postedMovementIds);
      const linked = shift.cashMovements.filter((item) => item.expenseId === owned!.id);
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        type: 'OUT',
        expenseStatus: 'VOIDED',
        expenseVoidReason: reason,
      });
      const expected = (value: Shift) =>
        Number(
          value.paymentReconciliations.find((item) => item.paymentMethodId === method!.id)!
            .expectedAmount
        );
      expect(expected(shift)).toBeCloseTo(expected(shiftBefore), 2);
    }
    if (!counted) {
      const shift = await api<Shift | null>(page, '/shifts/active?includeExpectations=true');
      expect(shift?.id ?? null).toBe(shiftBefore?.id ?? null);
      if (shift && shiftBefore) {
        expect(shift.cashMovements).toEqual(shiftBefore.cashMovements);
        expect(shift.paymentReconciliations).toEqual(shiftBefore.paymentReconciliations);
      }
    }
  } finally {
    page.off('request', recordPost);
    if (owned) {
      const persisted = await api<Expense>(page, `/expenses/${owned.id}`);
      expect(persisted.description, 'Never clean up an unrelated expense').toBe(description);
      if (persisted.status === 'POSTED') {
        const cleaned = await api<Expense>(page, `/expenses/${owned.id}/void`, `${prefix}-cleanup`);
        expect(
          cleaned.status,
          `BLOCKED: preserve expense ${owned.id} if associated shift closed; never open another shift`
        ).toBe('VOIDED');
      }
    }
  }
}

serialDescribe('@expenses @reports @real @manual expense lifecycle', () => {
  test('non-counted creation, dates, filters, detail actions and audited void', async ({
    page,
  }) => {
    await exerciseExpense(page, false, await preflight(page));
  });

  test('counted creation retains one OUT and void restores expectations on the same open shift', async ({
    page,
  }) => {
    await exerciseExpense(page, true, await preflight(page));
  });
});
