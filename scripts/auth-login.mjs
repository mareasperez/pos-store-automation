export async function submitLoginWhenReady(page, timeout = 120_000) {
  await page.locator('button[type="submit"]').click({ timeout });
}