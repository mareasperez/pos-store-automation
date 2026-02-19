import { type Page } from '@playwright/test';
import esTranslation from '../../../../frontend/public/locales/es/translation.json';

export async function ensureShiftIsOpen(page: Page) {
  const openShiftButton = page.getByRole('button', { name: esTranslation.shifts.open_shift_button }).first();
  if (!(await openShiftButton.isVisible({ timeout: 2_000 }).catch(() => false))) return;

  await openShiftButton.click();
  await page.getByLabel(esTranslation.shifts.initial_cash).fill('100');
  await page.getByRole('button', { name: esTranslation.shifts.open_shift_button }).last().click();
}
