import { expect, type Page } from '@playwright/test';
import { config } from '@config';
import { buildApiHeaders } from './sales.flow';
import { expectResponseOk } from './apiAssertions';

export interface PurchaseLineSummary {
  productId: number;
  presentationId: number;
  quantity: number;
}

export interface CreatedPurchaseSummary {
  id: number;
  lines?: PurchaseLineSummary[];
}

export interface PurchasablePair {
  supplierId: number;
  supplierName: string;
  productId: number;
  productName: string;
}

export interface NonBasePurchasePresentationCandidate extends PurchasablePair {
  presentationId: number;
  presentationName: string;
  conversionFactor: number;
}

interface ExistingSupplier {
  id: number;
  name: string;
  active?: boolean;
}

interface ExistingProduct {
  id: number;
  name: string;
  active?: boolean;
  type?: 'STANDARD' | 'SERVICE' | 'GENERIC';
  preferredSupplierId?: number | null;
}

interface ExistingPresentation {
  id: number;
  productId: number;
  presentationTypeName?: string;
  conversionFactor: number;
  active?: boolean;
  isBasePresentation?: boolean;
}

function toArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (
    payload &&
    typeof payload === 'object' &&
    'content' in payload &&
    Array.isArray((payload as { content?: unknown }).content)
  ) {
    return (payload as { content: T[] }).content;
  }
  return [];
}

async function fetchActiveSuppliers(page: Page): Promise<ExistingSupplier[]> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(
    `${config.apiRoot}/inventory/suppliers?page=0&size=50&sort=createdAt,desc`,
    { headers }
  );
  if (!response.ok()) return [];
  return toArray<ExistingSupplier>(await response.json()).filter(
    (supplier) => supplier.active !== false
  );
}

async function fetchActiveProducts(page: Page): Promise<ExistingProduct[]> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/products`, { headers });
  if (!response.ok()) return [];
  return toArray<ExistingProduct>(await response.json()).filter(
    (product) => product.active !== false && product.type !== 'SERVICE'
  );
}

async function fetchAllPresentations(page: Page): Promise<ExistingPresentation[]> {
  const headers = await buildApiHeaders(page);
  const response = await page.request.get(`${config.apiRoot}/product-presentations`, { headers });
  if (!response.ok()) return [];
  return (await response.json()) as ExistingPresentation[];
}

function isSupplierCompatible(product: ExistingProduct, supplierId: number): boolean {
  return product.preferredSupplierId == null || product.preferredSupplierId === supplierId;
}

/** Finds an active supplier + a product with exactly one (base, factor 1) active presentation. */
export async function findPurchasablePairWithSinglePresentation(
  page: Page
): Promise<PurchasablePair | null> {
  const [suppliers, products, presentations] = await Promise.all([
    fetchActiveSuppliers(page),
    fetchActiveProducts(page),
    fetchAllPresentations(page),
  ]);

  const activePresentationsByProductId = new Map<number, ExistingPresentation[]>();
  for (const presentation of presentations) {
    if (presentation.active === false) continue;
    const list = activePresentationsByProductId.get(presentation.productId) ?? [];
    list.push(presentation);
    activePresentationsByProductId.set(presentation.productId, list);
  }

  for (const supplier of suppliers) {
    const product = products.find((candidate) => {
      if (!isSupplierCompatible(candidate, supplier.id)) return false;
      const candidatePresentations = activePresentationsByProductId.get(candidate.id) ?? [];
      return (
        candidatePresentations.length === 1 &&
        Number(candidatePresentations[0].conversionFactor) === 1
      );
    });

    if (product) {
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        productId: product.id,
        productName: product.name,
      };
    }
  }

  return null;
}

/** Finds an active supplier + a product that has a non-base presentation (factor > 1). */
export async function findPurchasablePairWithNonBasePresentation(
  page: Page
): Promise<NonBasePurchasePresentationCandidate | null> {
  const [suppliers, products, presentations] = await Promise.all([
    fetchActiveSuppliers(page),
    fetchActiveProducts(page),
    fetchAllPresentations(page),
  ]);

  const nonBaseByProductId = new Map<number, ExistingPresentation>();
  for (const presentation of presentations) {
    if (presentation.active === false) continue;
    if (presentation.isBasePresentation) continue;
    if (Number(presentation.conversionFactor) <= 1) continue;
    if (!presentation.presentationTypeName) continue;
    if (!nonBaseByProductId.has(presentation.productId)) {
      nonBaseByProductId.set(presentation.productId, presentation);
    }
  }

  for (const supplier of suppliers) {
    const product = products.find(
      (candidate) =>
        isSupplierCompatible(candidate, supplier.id) && nonBaseByProductId.has(candidate.id)
    );
    if (!product) continue;

    const presentation = nonBaseByProductId.get(product.id)!;
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      productId: product.id,
      productName: product.name,
      presentationId: presentation.id,
      presentationName: presentation.presentationTypeName!,
      conversionFactor: Number(presentation.conversionFactor),
    };
  }

  return null;
}

async function selectSupplier(page: Page, supplierName: string): Promise<void> {
  const supplierInput = page.getByTestId('purchase-supplier-input');
  await expect(supplierInput).toBeVisible({ timeout: 20_000 });
  await expect(supplierInput).not.toHaveAttribute('placeholder', /cargando/i, { timeout: 15_000 });
  await supplierInput.click();
  await expect(page.locator('[data-slot="combobox-item"]').first()).toBeVisible({
    timeout: 10_000,
  });
  await supplierInput.pressSequentially(supplierName, { delay: 40 });
  const option = page
    .locator('[data-slot="combobox-item"]')
    .filter({ hasText: supplierName })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

async function fillLineUnitCost(page: Page, productName: string, unitCost: string): Promise<void> {
  const lineRow = page.locator('tbody tr', { hasText: productName }).first();
  await expect(lineRow).toBeVisible({ timeout: 20_000 });

  const table = lineRow.locator('xpath=ancestor::table[1]');
  const headers = table.locator('thead th');
  const headerCount = await headers.count();
  let unitCostColumnIndex = -1;
  for (let index = 0; index < headerCount; index += 1) {
    const headerText = (await headers.nth(index).innerText()).trim();
    if (/costo unit\.?|unit cost|cost/i.test(headerText)) {
      unitCostColumnIndex = index;
      break;
    }
  }
  if (unitCostColumnIndex === -1) {
    throw new Error('Unit cost column not found in purchase line table.');
  }

  const unitCostInput = lineRow
    .locator('td')
    .nth(unitCostColumnIndex)
    .locator('input[type="number"]');
  await expect(unitCostInput).toBeVisible({ timeout: 20_000 });
  await unitCostInput.fill(unitCost);
  await expect(unitCostInput).toHaveValue(unitCost, { timeout: 20_000 });
}

/** Adds a line using the inline row search — picks whichever presentation the typeahead resolves first. */
async function addLineViaInlineSearch(
  page: Page,
  productName: string,
  unitCost: string
): Promise<void> {
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.fill(productName);
  await page
    .getByRole('option', { name: new RegExp(productName, 'i') })
    .first()
    .click();
  await fillLineUnitCost(page, productName, unitCost);
}

/** Adds a line via the item-search modal, picking the option matching BOTH product and presentation name. */
async function addLineWithPresentation(
  page: Page,
  productName: string,
  presentationName: string,
  unitCost: string
): Promise<void> {
  const productSearchInput = page.locator('input[name="productSearch"]').first();
  await expect(productSearchInput).toBeVisible({ timeout: 20_000 });
  await productSearchInput.click();
  await productSearchInput.press('Enter');

  const modalSearchInput = page
    .getByPlaceholder(/nombre, c[oó]digo o barcode|name, code or barcode/i)
    .first();
  await expect(modalSearchInput).toBeVisible({ timeout: 20_000 });
  await modalSearchInput.fill(productName);

  const option = page
    .getByRole('button')
    .filter({ hasText: productName })
    .filter({ hasText: presentationName })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  await fillLineUnitCost(page, productName, unitCost);
}

async function confirmAndGetReceipt(page: Page): Promise<CreatedPurchaseSummary> {
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/inventory/purchase-receipts')
  );

  await page.getByRole('button', { name: /comprar|purchase/i }).click();
  await expect(page.getByText(/confirmar compra|confirm purchase/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await page
    .getByRole('button', { name: /confirmar|confirm/i })
    .last()
    .click();

  const createResponse = await createResponsePromise;
  await expectResponseOk(createResponse, 'Purchase receipt create response');
  return (await createResponse.json()) as CreatedPurchaseSummary;
}

async function openNewPurchaseForm(page: Page, supplierName: string): Promise<string> {
  await page.goto('/inventory/purchases', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/inventory\/purchases(?:$|[?#])/i, { timeout: 20_000 });
  await page.getByRole('button', { name: /nueva compra|new purchase/i }).click();
  await expect(page.getByText(/^purchase$|^compra$/i).first()).toBeVisible({ timeout: 20_000 });
  await selectSupplier(page, supplierName);

  const invoiceRef = `INV-E2E-STOCK-${Date.now().toString(36).toUpperCase()}`;
  await page.getByPlaceholder('INV-9876').fill(invoiceRef);
  return invoiceRef;
}

/** Creates a purchase for whichever presentation the inline product search resolves (usually the base one). */
export async function createPurchaseViaInlineSearch(
  page: Page,
  pair: PurchasablePair,
  unitCost = '10.00'
): Promise<CreatedPurchaseSummary> {
  await openNewPurchaseForm(page, pair.supplierName);
  await addLineViaInlineSearch(page, pair.productName, unitCost);
  return await confirmAndGetReceipt(page);
}

/** Creates a purchase explicitly for the given non-base presentation. */
export async function createPurchaseWithPresentation(
  page: Page,
  candidate: NonBasePurchasePresentationCandidate,
  unitCost = '10.00'
): Promise<CreatedPurchaseSummary> {
  await openNewPurchaseForm(page, candidate.supplierName);
  await addLineWithPresentation(page, candidate.productName, candidate.presentationName, unitCost);
  return await confirmAndGetReceipt(page);
}
