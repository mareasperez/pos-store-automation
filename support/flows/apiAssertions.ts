import { expect, type Response } from '@playwright/test';

export async function expectResponseStatus(
  response: Response,
  expectedStatus: number,
  context: string
): Promise<void> {
  const body = await response.text();

  expect(response.status(), `${context} failed with body: ${body}`).toBe(expectedStatus);
}

export async function expectResponseOk(response: Response, context: string): Promise<void> {
  const body = await response.text();

  expect(response.ok(), `${context} failed with status ${response.status()} and body: ${body}`).toBe(
    true
  );
}
