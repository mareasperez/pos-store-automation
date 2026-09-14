export async function submitLoginWhenReady(page, timeout = 120_000) {
  await page.locator('button[type="submit"]').click({ timeout });
}

export async function closeOwnedAuthBrowser({
  browser,
  context,
  ownsBrowser,
  ownsConnectedBrowser,
}) {
  if (ownsBrowser) {
    await context.close();
    await browser.close();
  } else if (ownsConnectedBrowser) {
    await browser.close();
  }
}