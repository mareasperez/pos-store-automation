import { test, expect } from '@playwright/test';

test('should return system version from backend', async ({ request }) => {
  const response = await request.get('http://localhost:8080/api/system/version');
  
  // Expect a 200 OK response
  expect(response.status()).toBe(200);
  
  const body = await response.json();
  expect(body).toHaveProperty('version');
});
