import type { TestInfo } from '@playwright/test';

export function buildUniqueTestToken(testInfo: TestInfo, prefix = 'E2E'): string {
  const worker = String(testInfo.workerIndex).padStart(2, '0');
  const repeat = String(testInfo.repeatEachIndex).padStart(2, '0');
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `${prefix}-W${worker}-R${repeat}-${time}-${random}`;
}
