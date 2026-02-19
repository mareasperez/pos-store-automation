import { expect, type Locator, type Page } from '@playwright/test';
import esTranslation from '@i18n/es/translation.json';
import { UI_TIMEOUT } from '@utils/ui-flow';
import { waitForBootstrap } from './auth-flow';

export async function selectTypeaheadOption(input: Locator, query: string) {
  // Ensure input is focused to trigger onFocus handlers and render the list
  await input.focus();

  // Wait for any potential loading state to clear if the component exposes it (SupplierSelector uses "Cargando providers...")
  // We can't easily detect the React state, but we can wait for the placeholder to NOT be "Cargando..."
  // or simply wait a bit for data if we know it fetches on mount.
  // Better approach: Retrying the type-and-select process if "No results" appears when we EXPECT results.

  const page = input.page();
  const list = page.locator('.typeahead__list');
  
  // Retry mechanism for typing and checking results
  // This handles cases where data loads AFTER we started typing
  for (let i = 0; i < 3; i++) {
    await input.clear();
    await input.pressSequentially(query, { delay: 100 });
    
    // Wait for either an item OR the "no results" message
    const itemOrEmpty = list.locator('.typeahead__item');
    await itemOrEmpty.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});

    // Check if we have valid items (not empty message)
    const validOption = list.locator('.typeahead__item:not(.typeahead__item--empty)').first();
    if (await validOption.isVisible()) {
        await validOption.click();
        return;
    }
    
    console.log(`DEBUG: Attempt ${i+1} - No valid options found for "${query}". Retrying...`);
    await page.waitForTimeout(1000); // Wait for potential data load
  }

  // Final attempt to grab error info
  const option = list.locator('.typeahead__item:not(.typeahead__item--empty)').first();
  try {
    await expect(option).toBeVisible({ timeout: 5000 });
  } catch (e) {
    const timestamp = Date.now();
    await page.screenshot({ path: `failure-typeahead-${timestamp}.png` });
    console.log(`DEBUG: Typeahead list visible: ${await list.isVisible()}`);
    console.log(`DEBUG: Typeahead HTML: ${await list.innerHTML().catch(() => 'NOT RENDERED')}`);
    throw e;
  }
  await option.click();
}

export async function selectAnySku(page: Page): Promise<string> {
  const skuInput = page.getByPlaceholder(esTranslation.inventory.search_placeholder);
  const attempts = ['a', 'e', 'i', 'o', 'u', '1'];

  for (const query of attempts) {
    await skuInput.fill(query);
    const option = page.locator('.typeahead__list .typeahead__item:not(.typeahead__item--empty)').first();

    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      const optionText = (await option.textContent())?.trim() || '';
      await option.click();
      return optionText;
    } else {
      console.log(`DEBUG: selectAnySku attempt "${query}" failed. List visible: ${await page.locator('.typeahead__list').isVisible()}`);
    }
  }

  throw new Error('No SKU option was found to register purchase.');
}

export async function createPurchaseViaUI(page: Page, supplierName: string): Promise<string> {
  await page.goto('/inventory/purchases/new?lng=es');
  
  // Wait for bootstrap after navigation (handles double-reloads)
  await waitForBootstrap(page);

  await expect(page.getByRole('heading', { name: esTranslation.inventory.purchase_receipt.title.replace(' (AIO)', ''), exact: false })).toBeVisible({
    timeout: UI_TIMEOUT,
  });

  // Use getByLabel for the supplier input as it is more robust than placeholder mapping
  const supplierTypeahead = page.getByLabel(esTranslation.inventory.supplier, { exact: false });
  await selectTypeaheadOption(supplierTypeahead, supplierName);

  const selectedSkuText = await selectAnySku(page);

  await page.getByLabel(esTranslation.pos.ticket.qty).fill('1');
  await page.getByLabel(esTranslation.inventory.purchase_receipt.invoice_ref).fill('REF-123');
  await page.getByRole('button', { name: esTranslation.inventory.purchase_receipt.save }).click();
  
  // The transaction is saved, now we click "Comprar" to process it
  await page.getByRole('button', { name: /Comprar/i }).click();
  
  // Wait for the Success Modal instead of a dialog
  const successModal = page.getByRole('dialog').filter({ hasText: /éxito|exitosamente|registrada/i });
  await expect(successModal).toBeVisible({ timeout: UI_TIMEOUT });
  
  // Interact with the modal to proceed
  await successModal.getByRole('button', { name: /Regresar|Cerrar/i }).first().click();
  
  return selectedSkuText;
}
