import { resolveE2EConfig } from '../utils/environment.mjs';
import { assertLocalProxyTarget } from '../utils/proxy-target.mjs';

export default async function globalSetup() {
  const config = resolveE2EConfig(process.env.E2E_ENV || 'local');
  await assertLocalProxyTarget(config);
}
