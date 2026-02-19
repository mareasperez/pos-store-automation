import { expect, type Locator, type Page } from '@playwright/test';
import esTranslation from '@i18n/es/translation.json';
import { UI_TIMEOUT } from '@utils/ui-flow';

export async function selectTypeaheadOption(input: Locator, query: string) {
  await input.fill(query);

  const option = input
    .page()
    .locator('.typeahead__list .typeahead__item:not(.typeahead__item--empty)')
    .first();

  await expect(option).toBeVisible({ timeout: UI_TIMEOUT });
  await option.click();
}

export async function selectAnySku(page: Page): Promise<string> {
  const skuInput = page.getByPlaceholder(esTranslation.inventory.search_placeholder);
  const attempts = ['a', 'e', 'i', 'o', 'u', '1'];

  for (const query of attempts) {
    await skuInput.fill(query);
    const option = page.locator('.typeahead__list .typeahead__item:not(.typeahead__item--empty)').first();

    if (await option.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const optionText = (await option.textContent())?.trim() || '';
      await option.click();
      return optionText;
    }
  }

  throw new Error('No SKU option was found to register purchase.');
}

export async function createPurchaseViaUI(page: Page, supplierName: string): Promise<string> {
  await page.goto('/inventory/purchases/new?lng=es');
  await expect(page.getByRole('heading', { name: esTranslation.inventory.purchase_receipt.title.replace(' (AIO)', '') })).toBeVisible({
    timeout: UI_TIMEOUT,
  });

  const supplierTypeahead = page.getByPlaceholder(esTranslation.inventory.purchase_history.supplier);
  await selectTypeaheadOption(supplierTypeahead, supplierName);

  const selectedSkuText = await selectAnySku(page);

  await page.getByLabel(esTranslation.pos.ticket.qty).fill('1');
  await page.getByLabel(esTranslation.inventory.purchase_receipt.invoice_ref).fill('REF-123');
  await page.getByRole('button', { name: esTranslation.inventory.purchase_receipt.save }).click();

  await expect(page.getByRole('table')).toBeVisible({ timeout: UI_TIMEOUT });

  const purchaseDialogPromise = page.waitForEvent('dialog');
  await page.getByRole('button', { name: /Comprar/i }).click();
  const purchaseDialog = await purchaseDialogPromise;

  expect(purchaseDialog.message()).toContain('successfully');
  await purchaseDialog.accept();

  return selectedSkuText;
}
