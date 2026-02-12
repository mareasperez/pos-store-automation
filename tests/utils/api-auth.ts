
import { APIRequestContext, expect, request } from '@playwright/test';

/**
 * Validates required environment variables for API tests.
 * Throws an error if any are missing.
 */
function validateEnv() {
  const missing: string[] = [];
  if (!process.env.API_URL) missing.push('API_URL');
  if (!process.env.TEST_USERNAME) missing.push('TEST_USERNAME');
  if (!process.env.TEST_PASSWORD) missing.push('TEST_PASSWORD');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for API tests: ${missing.join(', ')}`);
  }
}

/**
 * logs in as the Global Admin using credentials from .env
 * @returns An authenticated APIRequestContext ready for use
 */
export async function loginAsGlobalAdmin(): Promise<APIRequestContext> {
  validateEnv();

  const baseURL = process.env.API_URL;
  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;

  // Create a new context specifically for this login flow
  const apiContext = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  });

  const response = await apiContext.post('/api/auth/login', {
    data: {
      username,
      password,
    },
  });

  expect(response.ok(), `Login failed with status ${response.status()}`).toBeTruthy();
  const body = await response.json();
  console.log('Login successful. User roles/data:', JSON.stringify(body, null, 2));
  
  // The backend sets HTTP-only cookies (access_token, refresh_token).
  // These are automatically stored in the apiContext for subsequent requests.

  return apiContext;
}
