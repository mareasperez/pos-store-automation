import { test } from '@playwright/test';
import { createCustomerViaUI, loginOrFail, uniqueName } from '@utils/ui-flow';

test('UI can create a customer', async ({ page }) => {
  await loginOrFail(page);

  const customerName = uniqueName('E2E Customer');
  await createCustomerViaUI(page, customerName);
});
