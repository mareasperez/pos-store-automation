import { test, expect } from '@fixtures';
import {
  api,
  seedFractional,
  type FractionalPresentation,
} from '../../support/flows/fractional.flow';
import { assertLocalSavedSession } from './fractional-real.helpers';

test('@local @serial persists fractional eligibility from the catalog editor', async ({ page }) => {
  const assertNoAuthRequests = await assertLocalSavedSession(page, [
    'products:create',
    'products:edit',
  ]);
  const fixture = await seedFractional(page, [9], 10, 2);
  expect(fixture.items).toHaveLength(1);
  const item = fixture.items[0]!;

  console.log(
    `${fixture.prefix}: catalog product ${item.id}, presentation ${item.presentation.id}`
  );
  await page.goto(`/catalog/products/${item.id}/edit?lng=es`, {
    waitUntil: 'domcontentloaded',
  });

  const presentationRow = page
    .getByRole('row')
    .filter({ hasText: `${item.name}-factor-${item.presentation.conversionFactor}` });
  await expect(presentationRow).toBeVisible();
  await presentationRow.getByRole('button', { name: 'Editar Presentación' }).click();

  const fractionalToggle = page.locator(`#allows-fractional-${item.presentation.id}`);
  await expect(fractionalToggle).toHaveAttribute('aria-checked', 'true');
  await fractionalToggle.click();
  await expect(fractionalToggle).toHaveAttribute('aria-checked', 'false');
  await fractionalToggle.click();
  await expect(fractionalToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();

  const updateResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() !== 'GET' &&
      new URL(response.url()).pathname.includes('/api/product-presentations')
    );
  });
  await page.getByRole('button', { name: 'Guardar Presentaciones', exact: true }).click();
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBeLessThan(300);

  const persistedPresentations = await api<FractionalPresentation[]>(
    page,
    `/product-presentations?productId=${item.id}`
  );
  expect(
    persistedPresentations.find((presentation) => presentation.id === item.presentation.id)
      ?.allowsFractionalQuantity
  ).toBe(true);

  await page.goto(`/catalog/products/${item.id}/edit?lng=es`, {
    waitUntil: 'domcontentloaded',
  });
  const persistedPresentationRow = page
    .getByRole('row')
    .filter({ hasText: `${item.name}-factor-${item.presentation.conversionFactor}` });
  await expect(persistedPresentationRow).toBeVisible();
  await persistedPresentationRow.getByRole('button', { name: 'Editar Presentación' }).click();
  await expect(fractionalToggle).toHaveAttribute('aria-checked', 'true');
  assertNoAuthRequests();
});
