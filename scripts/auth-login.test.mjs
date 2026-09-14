import assert from 'node:assert/strict';
import test from 'node:test';
import { closeOwnedAuthBrowser, submitLoginWhenReady } from './auth-login.mjs';

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

test('closes a normal Chrome instance launched by the auth setup', async () => {
  let browserClosed = false;

  await closeOwnedAuthBrowser({
    browser: {
      async close() {
        browserClosed = true;
      },
    },
    context: undefined,
    ownsBrowser: false,
    ownsConnectedBrowser: true,
  });

  assert.equal(browserClosed, true);
});

test('keeps an externally managed CDP browser open', async () => {
  let browserClosed = false;

  await closeOwnedAuthBrowser({
    browser: {
      async close() {
        browserClosed = true;
      },
    },
    context: undefined,
    ownsBrowser: false,
    ownsConnectedBrowser: false,
  });

  assert.equal(browserClosed, false);
});