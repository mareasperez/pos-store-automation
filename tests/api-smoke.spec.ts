import { test, expect } from '@playwright/test';
import { config } from '../utils/config';

test('should return system status from backend', async ({ request }) => {
  const response = await request.get(`${config.apiUrl}/actuator/health`);
  
  // Expect a 200 OK response
  expect(response.status()).toBe(200);
  
  const body = await response.json();
  expect(body).toHaveProperty('status', 'UP');
});
