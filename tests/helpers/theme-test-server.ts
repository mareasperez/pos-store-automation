import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createServer,
  type InlineConfig,
  type ViteDevServer,
} from '../../../frontend/node_modules/vite/dist/node/index.js';

/**
 * Keep each helper's optimized dependencies separate from the user's running app.
 * The disposable cache stays under this project's test output, never in the app cache.
 */
export async function startThemeTestServer(config: InlineConfig): Promise<ViteDevServer> {
  const output = resolve(process.cwd(), 'test-results');
  await mkdir(output, { recursive: true });
  const cacheDir = await mkdtemp(resolve(output, 'theme-vite-'));
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({ ...config, cacheDir });
    const close = server.close.bind(server);
    let closing: Promise<void> | undefined;
    server.close = () => {
      closing ??= (async () => {
        try {
          await close();
        } finally {
          await rm(cacheDir, { recursive: true, force: true });
        }
      })();
      return closing;
    };
    await server.listen();
    return server;
  } catch (error) {
    try {
      await server?.close();
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
    throw error;
  }
}
