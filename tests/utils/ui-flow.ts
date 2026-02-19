import { faker } from '@faker-js/faker';

// Re-exports for a single entry point (Orchestrator)
export * from '@flows/auth-flow';
export * from '@flows/supplier-flow';
export * from '@flows/customer-flow';
export * from '@flows/inventory-flow';
export * from '@flows/shift-flow';

// Shared constants and utilities
export const UI_TIMEOUT = 60_000;

export function uniqueName(prefix: string): string {
  return `${prefix} ${faker.word.adjective()} ${Date.now().toString().slice(-4)}`;
}
