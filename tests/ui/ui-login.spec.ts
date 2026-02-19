import { test, expect } from '@playwright/test';
import { loginOrFail } from '@utils/ui-flow';

test('UI login works with configured credentials', async ({ page }) => {
  await loginOrFail(page);
  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i);
});
