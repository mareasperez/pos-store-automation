import { expect, test, type Page } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('ERR_ABORTED')) {
      throw error;
    }

    await page.goto(path, { waitUntil: 'domcontentloaded' });
  }
}

test('@smoke @auth @manual landing is reachable', async ({ page }) => {
  await gotoWithRetry(page, '/?lng=es');
  await expect(page).toHaveTitle(/mypos\s*go/i);
});
