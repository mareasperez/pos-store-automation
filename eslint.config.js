import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['test-results', 'playwright-report', 'playwright/.cache']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      playwright.configs['flat/recommended'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Downgraded to warn: pre-existing spec files rely on these patterns already (dynamic
      // `test.skip()` for missing tenant data, `networkidle` waits) — ratchet up once cleaned up.
      'playwright/no-networkidle': 'warn',
    },
  },
]);
