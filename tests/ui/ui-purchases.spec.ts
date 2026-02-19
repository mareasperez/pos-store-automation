import { test } from '@playwright/test';
import { createPurchaseViaUI, createSupplierViaUI, loginOrFail, uniqueName } from '@utils/ui-flow';

test('UI can create a purchase receipt', async ({ page }) => {
  await loginOrFail(page);

  const supplierName = uniqueName('E2E Supplier Purchase');
  await createSupplierViaUI(page, supplierName);
  await createPurchaseViaUI(page, supplierName);
});
