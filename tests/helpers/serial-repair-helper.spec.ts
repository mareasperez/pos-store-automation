import { expect, test } from '@playwright/test';
import { addProductToCart } from '../../support/flows/sales.flow';
import { fillReturnSaleQuantities } from '../../support/flows/returns.flow';
import { waitForQuoteSaleReady } from '../../support/flows/quotes.flow';
import { assertComboActorAndShift, assertComboEnvironment } from '../../support/flows/combos.flow';
import { expenseTimeZone } from '../../support/flows/expense-preflight.flow';

test('expense dates use the tenant zone or the uniquely observed runtime default', () => {
  const configs = [{ defaults: { timeZone: 'America/Managua' } }];
  expect(expenseTimeZone('America/Costa_Rica', configs)).toBe('America/Costa_Rica');
  expect(expenseTimeZone('invalid-zone', configs)).toBe('America/Managua');
  expect(() => expenseTimeZone(undefined, [])).toThrow(/never guess/i);
  expect(() => expenseTimeZone(undefined, [...configs, ...configs])).toThrow(/never guess/i);
});

test('requires the authenticated actor, permissions and their own open shift', () => {
  expect(() => assertComboEnvironment('local')).not.toThrow();
  expect(() => assertComboEnvironment('dev')).not.toThrow();
  expect(() => assertComboEnvironment('prod')).toThrow();
  const user = { id: 8, username: 'cashier' };
  const actor = { username: 'cashier', permissions: ['sales:create'] };
  const shift = { userId: 8, status: 'OPEN' };
  expect(() => assertComboActorAndShift(user, actor, shift, ['sales:create'])).not.toThrow();
  expect(() =>
    assertComboActorAndShift(user, { ...actor, username: 'other' }, shift, [])
  ).toThrow();
  expect(() => assertComboActorAndShift(user, actor, { ...shift, userId: 9 }, [])).toThrow();
  expect(() => assertComboActorAndShift(user, actor, { ...shift, status: 'CLOSED' }, [])).toThrow();
  expect(() => assertComboActorAndShift(user, actor, shift, ['returns:create'])).toThrow();
});

test('selects only the requested product and presentation, not a native option or another product', async ({
  page,
}) => {
  await page.setContent(`
    <select hidden><option>Selecciona bodega</option></select>
    <input data-testid="pos-product-search">
    <div data-testid="pos-product-suggestions" role="listbox" aria-label="Suggestions de produits">
      <div role="option"><span>Other product</span><span>Unit</span></div>
      <div role="option" onmousedown="this.parentElement.remove(); document.body.insertAdjacentHTML('beforeend', '<p>Target product</p>')">
        <span>Target product</span><span>Box</span>
      </div>
    </div>
  `);
  await addProductToCart(page, 'Target product', 'Box');
  await expect(page.getByText('Target product', { exact: true }).last()).toBeVisible();
});

test('never substitutes a different product when the requested suggestion is absent', async ({
  page,
}) => {
  test.setTimeout(20_000);
  await page.setContent(`
    <select hidden><option>Selecciona bodega</option></select>
    <input data-testid="pos-product-search">
    <div data-testid="pos-product-suggestions" role="listbox" aria-label="Suggestions de produits">
      <div role="option" onmousedown="document.body.dataset.wrong = 'selected'">
        <span>Other product</span><span>Unit</span>
      </div>
    </div>
  `);
  await expect(addProductToCart(page, 'Missing product')).rejects.toThrow(/No in-stock suggestion/);
  await expect(page.locator('body')).not.toHaveAttribute('data-wrong', 'selected');
});

test('fills each return line with its exact sold quantity, including duplicate product presentations', async ({
  page,
}) => {
  await page.setContent(`
    <input data-testid="customer-return-qty-5:7">
    <input data-testid="customer-return-qty-5:7">
    <input data-testid="customer-return-qty-6:8">
  `);
  await fillReturnSaleQuantities(page, [
    { id: 1, productId: 5, presentationId: 7, quantity: 0.1234 },
    { id: 2, productId: 5, presentationId: 7, quantity: 2 },
    { id: 3, productId: 6, presentationId: 8, quantity: 0.9725 },
  ]);
  await expect(page.getByTestId('customer-return-qty-5:7').nth(0)).toHaveValue('0.1234');
  await expect(page.getByTestId('customer-return-qty-5:7').nth(1)).toHaveValue('2');
  await expect(page.getByTestId('customer-return-qty-6:8')).toHaveValue('0.9725');
});

test('waits for delayed quote eligibility instead of treating loading as a terminal state', async ({
  page,
}) => {
  await page.setContent('<p>Cargando proforma...</p>');
  let settled = false;
  const ready = waitForQuoteSaleReady(page).then(() => {
    settled = true;
  });
  await expect(page.getByText('Cargando proforma...')).toBeVisible();
  expect(settled).toBe(false);
  await page.evaluate(() => {
    document.body.innerHTML =
      '<div data-testid="pos-quote-unavailable"><p data-testid="pos-quote-fractional-block">Target</p></div>';
  });
  await ready;
  await expect(page.getByTestId('pos-quote-fractional-block')).toHaveText('Target');
});
