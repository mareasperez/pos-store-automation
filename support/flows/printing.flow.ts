import { expect, type Locator, type Page } from '@playwright/test';

type PrintJobType = 'collection-receipt' | 'customer-statement';

declare global {
  interface Window {
    __e2ePrintCalls?: number;
  }
}

/**
 * Replaces `window.print` with a counter so tests never open the native print dialog. Must run
 * before the first navigation of the test. `afterprint` is not fired, so the print portal stays
 * mounted for assertions until `finishPrintJob` is called.
 */
export async function stubWindowPrint(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__e2ePrintCalls = 0;
    window.print = () => {
      window.__e2ePrintCalls = (window.__e2ePrintCalls ?? 0) + 1;
    };
  });
}

export async function getPrintCalls(page: Page): Promise<number> {
  return page.evaluate(() => window.__e2ePrintCalls ?? 0);
}

/** Waits for `window.print` to be called and returns the print-service portal for the job type. */
export async function expectPrintJob(
  page: Page,
  type: PrintJobType,
  minCalls = 1
): Promise<Locator> {
  await expect
    .poll(() => getPrintCalls(page), { timeout: 15_000, message: `window.print for ${type}` })
    .toBeGreaterThanOrEqual(minCalls);
  // The portal is print-only (hidden on screen), so assert attachment and text, not visibility.
  const portal = page.locator(`[data-print-service-root][data-print-job-type="${type}"]`);
  await expect(portal).toBeAttached();
  return portal;
}

/** Simulates closing the browser print dialog so the print service releases the job. */
export async function finishPrintJob(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('[data-print-service-root]')).toHaveCount(0);
}

/** Digits of an amount with two decimals, so assertions ignore currency symbols and separators. */
export function amountDigits(value: number): string {
  return Math.round(value * 100).toString();
}

export function digitsOnly(text: string | null): string {
  return (text ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}
