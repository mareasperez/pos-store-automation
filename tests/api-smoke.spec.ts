import { expect, test } from '@playwright/test';
import { config } from '@config';

test('@smoke @api backend health endpoint is up', async ({ request }) => {
  const healthUrl = `${config.apiUrl.replace(/\/api\/?$/, '')}/actuator/health`;
  const response = await request.get(healthUrl);

  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toHaveProperty('status', 'UP');
});
