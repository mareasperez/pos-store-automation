import { test } from '@playwright/test';
import { config } from '@config';

export function requireCredentialsOrSkip(flowName: string): void {
  test.skip(
    !config.credentials.username || !config.credentials.password,
    `Set TEST_USERNAME and TEST_PASSWORD (or E2E_USERNAME/E2E_PASSWORD) to run ${flowName}.`
  );
}