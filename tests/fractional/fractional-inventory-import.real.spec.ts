import * as XLSX from 'xlsx';
import { test, expect } from '@fixtures';
import type { Page } from '@playwright/test';
import {
  api,
  seedFractional,
  stockIs,
  type FractionalPresentation,
} from '../../support/flows/fractional.flow';
import { assertConfiguredSavedSession } from './fractional-real.helpers';

interface ImportResult {
  successCount: number;
  failureCount: number;
  messages: string[];
}

function inventoryWorkbook(
  sku: string,
  productName: string,
  presentationName: string,
  wholeOnlyPresentationName: string,
  quantity: number,
  cost: number,
  missingSku: string
): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [
      'SKU',
      'Product Name',
      'Presentation Name',
      'Conversion Factor',
      'Quantity',
      'Presentation Cost',
    ],
    [sku, productName, presentationName, 2, quantity, cost],
    [sku, productName, presentationName, 2, 0.00001, cost],
    [sku, productName, wholeOnlyPresentationName, 1, 0.5, cost],
    [missingSku, `${productName}-missing`, presentationName, 2, 1, cost],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
  return Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}

async function importInventoryWorkbook(
  page: Page,
  warehouseId: number,
  mode: 'create' | 'update',
  fileName: string,
  workbook: Buffer,
  sku: string,
  missingSku: string
): Promise<ImportResult> {
  await page.goto('/settings/import?lng=es', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.import-card').filter({ hasText: 'Stock Inicial' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Importar', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('radio', {
      name: mode === 'create' ? 'Crear registros nuevos' : 'Actualizar registros existentes',
    })
    .check();

  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
  const warehouse = dialog.getByLabel('Bodega Destino');
  await expect(warehouse).toBeVisible();
  await expect(warehouse.locator(`option[value="${warehouseId}"]`)).toHaveCount(1);
  await warehouse.selectOption(String(warehouseId));
  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook,
  });
  await expect(dialog.getByText(fileName, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Ejecutar validación', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Paso 4: Revisar importación' })).toBeVisible();
  await expect(dialog.getByRole('cell', { name: sku, exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('cell', { name: missingSku, exact: true })).toBeVisible();

  const importResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    return request.method() === 'POST' && path === `/api/import/inventory/${mode}`;
  });
  await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
  const importResponse = await importResponsePromise;
  expect(importResponse.ok()).toBe(true);
  const result = (await importResponse.json()) as ImportResult;

  await expect(dialog.getByText('Éxitos', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Fallos', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Detalles del Error/ })).toBeVisible();
  return result;
}

test('@configured-target @serial imports fractional stock in create and update modes with partial rejects', async ({
  page,
}) => {
  const assertNoAuthRequests = await assertConfiguredSavedSession(page, [
    'settings:general:edit',
    'products:create',
    'products:edit',
  ]);
  const fixture = await seedFractional(page, [7.5], 10, 1);
  expect(fixture.items).toHaveLength(1);
  const item = fixture.items[0]!;
  const wholeOnlyPresentation = await api<FractionalPresentation>(
    page,
    `/product-presentations/${item.presentation.id}`,
    'PUT',
    { ...item.presentation, allowsFractionalQuantity: false }
  );

  const presentationTypes = await api<{
    content: { id: number; name: string; isDivisible: boolean }[];
  }>(page, '/presentation-types');
  const baseType = presentationTypes.content.find(
    (type) => type.id === wholeOnlyPresentation.presentationTypeId
  );
  expect(baseType, 'Owned base presentation type must exist').toBeDefined();
  expect(baseType!.isDivisible).toBe(true);
  const presentationType = presentationTypes.content.find(
    (type) => type.id !== item.presentation.presentationTypeId && type.name === 'Unidad'
  );
  expect(
    presentationType,
    'Existing distinct Unidad type; no global catalog changes'
  ).toBeDefined();
  const ownedPresentationType = presentationType!;
  // Normal catalog path; repeated-type matching has isolated backend coverage.
  item.presentation = await api<FractionalPresentation>(
    page,
    `/product-presentations?productId=${item.id}`,
    'POST',
    {
      productId: item.id,
      presentationTypeId: ownedPresentationType.id,
      conversionFactor: 2,
      price: 7.5,
      cost: 0.01,
      taxRate: 0,
      barcode: `${item.name}-factor-2`,
      active: true,
      isBasePresentation: false,
      priceMode: 'PRICE_DRIVEN',
      allowsFractionalQuantity: true,
    }
  );
  expect(item.presentation.conversionFactor).toBe(2);
  expect(item.presentation.allowsFractionalQuantity).toBe(true);
  const persistedPresentations = await api<FractionalPresentation[]>(
    page,
    `/product-presentations?productId=${item.id}`
  );
  const baseMatches = persistedPresentations.filter(
    (presentation) => presentation.presentationTypeId === baseType!.id
  );
  expect(baseMatches).toHaveLength(1);
  expect(baseMatches[0]).toMatchObject({
    id: wholeOnlyPresentation.id,
    productId: item.id,
    isBasePresentation: true,
    conversionFactor: 1,
    active: true,
    allowsFractionalQuantity: false,
  });
  expect(
    persistedPresentations.filter(
      (presentation) => presentation.presentationTypeId === ownedPresentationType.id
    )
  ).toHaveLength(1);
  await stockIs(page, fixture, item, 10);

  const missingSku = `${fixture.prefix}-MISSING`;
  const createWorkbook = inventoryWorkbook(
    item.name,
    item.name,
    ownedPresentationType.name,
    baseType!.name,
    0.25,
    1,
    missingSku
  );
  const updateWorkbook = inventoryWorkbook(
    item.name,
    item.name,
    ownedPresentationType.name,
    baseType!.name,
    5.125,
    1.25,
    missingSku
  );
  expect(createWorkbook.equals(updateWorkbook)).toBe(false);
  console.log(
    `${fixture.prefix}: inventory product ${item.id}, presentation ${item.presentation.id}, warehouse ${fixture.warehouse.id}`
  );

  const createResult = await importInventoryWorkbook(
    page,
    fixture.warehouse.id,
    'create',
    `${fixture.prefix}-create.xlsx`,
    createWorkbook,
    item.name,
    missingSku
  );
  expect(createResult).toEqual({
    successCount: 1,
    failureCount: 3,
    messages: expect.arrayContaining([expect.any(String)]),
  });
  expect(createResult.messages).toHaveLength(3);
  expect(createResult.messages).toContainEqual(expect.stringContaining(`Row 3 [SKU=${item.name}]`));
  expect(
    createResult.messages.find((message) => message.startsWith(`Row 4 [SKU=${item.name}]:`))
  ).toContain('the presentation does not allow fractional quantities');
  expect(createResult.messages).toContainEqual(expect.stringContaining(missingSku));
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true })
  ).toBeVisible();
  await stockIs(page, fixture, item, 10.5);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();

  const updateResult = await importInventoryWorkbook(
    page,
    fixture.warehouse.id,
    'update',
    `${fixture.prefix}-update.xlsx`,
    updateWorkbook,
    item.name,
    missingSku
  );
  expect(updateResult.successCount).toBe(1);
  expect(updateResult.failureCount).toBe(3);
  expect(updateResult.messages).toHaveLength(3);
  expect(updateResult.messages).toContainEqual(expect.stringContaining(`Row 3 [SKU=${item.name}]`));
  expect(
    updateResult.messages.find((message) => message.startsWith(`Row 4 [SKU=${item.name}]:`))
  ).toContain('the presentation does not allow fractional quantities');
  expect(updateResult.messages).toContainEqual(expect.stringContaining(missingSku));
  await stockIs(page, fixture, item, 10.25);
  assertNoAuthRequests();
});
