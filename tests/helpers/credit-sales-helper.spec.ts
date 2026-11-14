import { expect, test } from '@playwright/test';
import { selectPosCustomer } from '../../support/flows/creditSales.flow';

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(15_000);

test('selects a customer after delayed catalog and balance readiness without response waiters', async ({
  page,
}) => {
  let releaseCustomers!: () => void;
  let releaseBalance!: () => void;
  let customerRequestStarted!: () => void;
  let balanceRequestStarted!: () => void;
  const customerGate = new Promise<void>((resolve) => {
    releaseCustomers = resolve;
  });
  const balanceGate = new Promise<void>((resolve) => {
    releaseBalance = resolve;
  });
  const customerStarted = new Promise<void>((resolve) => {
    customerRequestStarted = resolve;
  });
  const balanceStarted = new Promise<void>((resolve) => {
    balanceRequestStarted = resolve;
  });

  await page.route('https://ui.example.invalid/api/customers', async (route) => {
    customerRequestStarted();
    await customerGate;
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: [{ id: 9, name: 'Jane Doe' }],
    });
  });
  await page.route('https://api.example.invalid/api/receivables/summary', async (route) => {
    balanceRequestStarted();
    await balanceGate;
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: { totalOutstanding: 0 },
    });
  });

  await page.setContent(`
    <input role="combobox" data-testid="pos-customer-select" disabled>
    <script>
      const customerInput = document.querySelector('[data-testid="pos-customer-select"]');
      let customers = [];
      fetch('https://ui.example.invalid/api/customers')
        .then((response) => response.json())
        .then((rows) => {
          customers = rows;
          customerInput.disabled = false;
        });

      customerInput.addEventListener('input', () => {
        document.querySelector('[role="option"]')?.remove();
        const customer = customers.find((item) =>
          item.name.toLowerCase().includes(customerInput.value.toLowerCase())
        );
        if (!customer) return;

        const option = document.createElement('button');
        option.setAttribute('role', 'option');
        option.textContent = customer.name;
        option.addEventListener('click', () => {
          customerInput.value = customer.name;
          customerInput.dataset.selectedCustomerId = String(customer.id);
          customerInput.dataset.selectedCustomerName = customer.name;
          const status = document.createElement('div');
          status.id = 'credit-balance-status';
          status.dataset.testid = 'pos-credit-balance-status';
          status.dataset.state = 'loading';
          status.setAttribute('role', 'status');
          status.textContent = 'Loading credit balance';
          document.body.append(status);
          fetch('https://api.example.invalid/api/receivables/summary')
            .then(() => {
              status.dataset.state = 'ready';
              status.textContent = 'Credit balance ready';
            });
        });
        document.body.append(option);
      });
    </script>
  `);

  const customerInput = page.getByTestId('pos-customer-select');
  const selectingCustomer = selectPosCustomer(page, 'Jane Doe');
  await customerStarted;
  await expect(customerInput).toBeDisabled();
  releaseCustomers();

  await expect(customerInput).toHaveValue('Jane Doe');
  const balanceStatus = page.getByTestId('pos-credit-balance-status');
  await balanceStarted;
  await expect(balanceStatus).toHaveAttribute('data-state', 'loading');
  releaseBalance();

  await selectingCustomer;

  await expect(customerInput).toHaveAttribute('data-selected-customer-id', '9');
  await expect(customerInput).toHaveAttribute('data-selected-customer-name', 'Jane Doe');
  await expect(balanceStatus).toHaveAttribute('data-state', 'ready');
});

test('does not reselect an already-selected customer or wait for another balance request', async ({
  page,
}) => {
  await page.setContent(`
    <input
      role="combobox"
      data-testid="pos-customer-select"
      data-selected-customer-id="9"
      data-selected-customer-name="Jane Doe"
      value="Jane Doe"
    >
    <div
      role="status"
      data-testid="pos-credit-balance-status"
      data-state="ready"
    >Credit balance ready</div>
  `);

  await selectPosCustomer(page, 'Jane Doe');

  await expect(page.getByTestId('pos-customer-select')).toHaveValue('Jane Doe');
  await expect(page.getByTestId('pos-customer-select')).toHaveAttribute(
    'data-selected-customer-id',
    '9'
  );
  await expect(page.getByTestId('pos-credit-balance-status')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await expect(page.getByRole('option')).toHaveCount(0);
});
