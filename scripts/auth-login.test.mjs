import assert from 'node:assert/strict';
import test from 'node:test';
import { submitLoginWhenReady } from './auth-login.mjs';

test('waits for the login button actionability and clicks it once', async () => {
  const calls = [];
  const page = {
    locator(selector) {
      calls.push(['locator', selector]);
      return {
        async click(options) {
          calls.push(['click', options]);
        },
      };
    },
  };

  await submitLoginWhenReady(page, 15_000);

  assert.deepEqual(calls, [
    ['locator', 'button[type="submit"]'],
    ['click', { timeout: 15_000 }],
  ]);
});