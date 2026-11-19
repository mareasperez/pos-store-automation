import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ViteDevServer } from '../../../frontend/node_modules/vite/dist/node/index.js';
import { startThemeTestServer } from './theme-test-server';

const root = resolve(process.cwd(), '..', 'frontend');

test('theme servers own unique caches and remove only their cache on close', async () => {
  const servers: ViteDevServer[] = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      servers.push(
        await startThemeTestServer({
          root,
          configFile: false,
          envFile: false,
          logLevel: 'silent',
          optimizeDeps: { noDiscovery: true, include: [] },
          server: { host: '127.0.0.1', port: 0, hmr: false },
        })
      );
    }
    const [first, second] = servers;
    expect(first.config.cacheDir).not.toBe(second.config.cacheDir);
    expect(first.config.cacheDir).not.toBe(resolve(root, 'node_modules', '.vite'));
    await access(first.config.cacheDir);
    await access(second.config.cacheDir);
    await first.close();
    await expect(access(first.config.cacheDir)).rejects.toThrow();
    await access(second.config.cacheDir);
    await second.close();
    await expect(access(second.config.cacheDir)).rejects.toThrow();
  } finally {
    await Promise.all(servers.map((server) => server.close()));
  }
});

test('theme cache is removed when server initialization fails', async () => {
  let ownedCache = '';
  await expect(
    startThemeTestServer({
      root,
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'fail-theme-fixture-initialization',
          configResolved(config) {
            ownedCache = config.cacheDir;
            throw new Error('Expected fixture initialization failure');
          },
        },
      ],
    })
  ).rejects.toThrow('Expected fixture initialization failure');
  expect(ownedCache).not.toBe('');
  await expect(access(ownedCache)).rejects.toThrow();
});
