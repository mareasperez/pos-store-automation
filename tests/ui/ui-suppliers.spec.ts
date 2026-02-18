import { test } from '@playwright/test';
import { createSupplierViaUI, loginOrFail, uniqueName } from '../utils/ui-flow';

test('UI can create a supplier', async ({ page }) => {
  await loginOrFail(page);

  const supplierName = uniqueName('E2E Supplier');
  await createSupplierViaUI(page, supplierName);
});
