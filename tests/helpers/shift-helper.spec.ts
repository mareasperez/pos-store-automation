import { expect, test, type Page } from '@playwright/test';
import { openShiftIfPrompted } from '../../utils/shift';

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(10_000);

function simulateShiftResolvingAfterVisibility(page: Page): void {
  const locate = page.locator.bind(page);
  page.locator = (selector, options) => {
    const locator = locate(selector, options);
    if (selector === '[data-testid="pos-open-shift"]:visible') {
      const isVisible = locator.isVisible.bind(locator);
      locator.isVisible = async (visibilityOptions) => {
        const visible = await isVisible(visibilityOptions);
        if (visible) {
          // Resolve the shift immediately after the visibility snapshot.
          await page.getByTestId('pos-open-shift').evaluate((button) => {
            const confirm = document.createElement('button');
            confirm.dataset.testid = 'pos-confirm-sale';
            confirm.textContent = 'Confirmar Venta';
            confirm.disabled = true;
            button.replaceWith(confirm);
          });
        }
        return visible;
      };
    }
    return locator;
  };
}

test('continues when the shift is already open even with an empty ticket', async ({ page }) => {
  await page.setContent('<button data-testid="pos-confirm-sale" disabled>Confirmar Venta</button>');

  await openShiftIfPrompted(page);

  await expect(page.getByTestId('pos-confirm-sale')).toBeVisible();
});

test('continues when the open-shift button disappears during the readiness check', async ({
  page,
}) => {
  await page.setContent('<button data-testid="pos-open-shift" disabled>Abrir Caja</button>');
  simulateShiftResolvingAfterVisibility(page);

  await openShiftIfPrompted(page);

  await expect(page.getByTestId('pos-confirm-sale')).toBeVisible();
  await expect(page.getByTestId('pos-open-shift')).toHaveCount(0);
});

test('still submits the initial cash when the shift needs opening', async ({ page }) => {
  await page.route('https://shift-helper.invalid/api/shifts/open', (route) =>
    route.fulfill({
      status: 201,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { status: 'OPEN' },
    })
  );
  await page.setContent('<button data-testid="pos-open-shift">Abrir Caja</button>');
  await page.getByTestId('pos-open-shift').evaluate((button) => {
    button.addEventListener('click', () => {
      const input = document.createElement('input');
      input.dataset.testid = 'shift-initial-cash-input';
      const submit = document.createElement('button');
      submit.dataset.testid = 'shift-open-submit';
      submit.textContent = 'Abrir';
      submit.addEventListener('click', async () => {
        await fetch('https://shift-helper.invalid/api/shifts/open', {
          method: 'POST',
          body: input.value,
        });
        const confirm = document.createElement('button');
        confirm.dataset.testid = 'pos-confirm-sale';
        confirm.textContent = 'Confirmar Venta';
        confirm.disabled = true;
        button.replaceWith(confirm);
      });
      document.body.append(input, submit);
    });
  });
  const opening = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/shifts/open')
  );

  await openShiftIfPrompted(page);

  expect((await opening).postData()).toBe('1');
  await expect(page.getByTestId('pos-confirm-sale')).toBeVisible();
});
