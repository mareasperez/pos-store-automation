import { test, expect } from '@fixtures';
import { config } from '@config';
import {
  addFractional,
  api,
  discount,
  openFractionalPos,
  payFractional,
  seedFractional,
} from '../../support/flows/fractional.flow';
import { assertConfiguredSavedSession } from './fractional-real.helpers';

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"' && quoted && csv[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if (character === '\n' && !quoted) {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

test('@configured-target @serial shows fractional quantity and manual discount in report UI and CSV', async ({
  page,
}) => {
  const assertNoAuthRequests = await assertConfiguredSavedSession(page, [
    'products:create',
    'sales:discount',
    'reports:view',
    'reports:export',
  ]);
  expect((await api<{ status: string }>(page, '/shifts/active')).status).toBe('OPEN');
  expect(
    (await api<{ currency: string }>(page, `/tenants/${config.tenantId}/settings`)).currency
  ).toBe('NIO');

  const fixture = await seedFractional(page, [200], 10, 1);
  expect(fixture.items).toHaveLength(1);
  const item = fixture.items[0]!;

  await openFractionalPos(page, fixture);
  await addFractional(page, item, '0.5');
  await discount(page, '10', `${fixture.prefix}-manual-discount`);
  const sale = await payFractional(page, fixture, '90');
  expect(sale.lines).toHaveLength(1);
  const saleLine = sale.lines[0]!;
  console.log(`${fixture.prefix}: sale ${sale.id}, number ${sale.saleNumber}, line ${saleLine.id}`);

  await page.goto('/reports/discounts-promotions?lng=es', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('searchbox', { name: 'Buscar productos, tickets o promociones' })
    .fill(item.name);
  const reportRow = page.getByTestId(`discount-row-${saleLine.id}`);
  await expect(reportRow).toBeVisible();
  await expect(reportRow).toContainText(item.name);
  await expect(reportRow).toContainText(sale.saleNumber);
  await expect(reportRow).toContainText(/0[,.]5/);
  await expect(reportRow.getByText('Descuento manual de la venta')).toBeVisible();
  await expect(
    reportRow
      .locator('dl > div')
      .filter({ has: page.getByText('Descuento manual de la venta', { exact: true }) })
      .getByRole('definition')
  ).toHaveText(/10,00\s*NIO/);
  const reportProduct = await reportRow.getByRole('heading', { level: 3 }).innerText();

  const exportResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    return (
      request.method() === 'GET' && path === '/api/reports/extensions/discounts-promotions/export'
    );
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar reporte completo (CSV)', exact: true }).click();
  const [exportResponse, download] = await Promise.all([exportResponsePromise, downloadPromise]);
  expect(exportResponse.ok()).toBe(true);
  expect(download.suggestedFilename()).toMatch(/^discounts-promotions_.*\.csv$/);

  const csv = new TextDecoder().decode(await exportResponse.body()).replace(/^\uFEFF/, '');
  const [headers, ...rows] = parseCsv(csv);
  expect(headers).toEqual([
    'lineId',
    'saleNumber',
    'product',
    'presentation',
    'promotion',
    'quantity',
    'listAmount',
    'soldAmount',
    'discountAmount',
    'measurement',
    'otherDiscountAmount',
    'manualDiscountAmount',
  ]);

  const column = (name: string): number => {
    const index = headers.indexOf(name);
    expect(index, `CSV header ${name}`).toBeGreaterThanOrEqual(0);
    return index;
  };
  const matchingRows = rows.filter(
    (row) =>
      row[column('lineId')] === String(saleLine.id) &&
      row[column('saleNumber')] === sale.saleNumber &&
      row[column('product')] === reportProduct
  );
  expect(matchingRows).toHaveLength(1);
  const reportRecord = matchingRows[0]!;
  expect(Number(reportRecord[column('quantity')])).toBeCloseTo(0.5);
  expect(Number(reportRecord[column('listAmount')])).toBeCloseTo(100);
  expect(Number(reportRecord[column('soldAmount')])).toBeCloseTo(90);
  expect(Number(reportRecord[column('discountAmount')])).toBeCloseTo(10);
  expect(Number(reportRecord[column('otherDiscountAmount')])).toBeCloseTo(0);
  expect(Number(reportRecord[column('manualDiscountAmount')])).toBeCloseTo(10);
  assertNoAuthRequests();
});
