import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@fixtures';
import type { Page } from '@playwright/test';
import { config } from '@config';
import { assertConfiguredTarget } from '../../support/flows/target.flow';
import { getEnvironmentPaths } from '../../utils/environment-paths.mjs';
import { hasDistinctActorIds, isConfiguredFrontendOrigin } from '../../utils/target-policy.mjs';

const authDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  getEnvironmentPaths(config.environment).authDir
);

export async function assertConfiguredSavedSession(
  page: Page,
  requiredPermissions: readonly string[]
): Promise<() => void> {
  page.setDefaultTimeout(15_000);
  return assertConfiguredTarget(page, { requiredPermissions });
}

export function assertThreeDistinctConfiguredActors(workerStateFile: string | undefined): void {
  expect(workerStateFile, 'A numbered saved session is required for every worker').toBeTruthy();
  const stateFiles = fs
    .readdirSync(authDirectory)
    .filter((file) => /^user-\d+\.json$/.test(file))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const workerFiles = ['user-0.json', 'user-1.json', 'user-2.json'];
  expect(stateFiles, 'Three numbered target sessions are required').toEqual(
    expect.arrayContaining(workerFiles)
  );
  expect(workerFiles).toContain(path.basename(workerStateFile!));

  const actorIds = workerFiles.map((file) => {
    const saved = JSON.parse(fs.readFileSync(path.join(authDirectory, file), 'utf8')) as {
      origins?: {
        origin: string;
        localStorage?: { name: string; value: string }[];
      }[];
    };
    const storage = saved.origins
      ?.find((origin) => isConfiguredFrontendOrigin(origin.origin, config.baseUrl))
      ?.localStorage?.find((item) => item.name === 'pos_app_store');
    expect(storage, 'Each worker session must belong to the configured frontend').toBeTruthy();
    const app = JSON.parse(storage!.value) as {
      state?: { activeTenantId?: string; user?: { id?: number | string } };
    };
    expect(app.state?.activeTenantId, 'Each worker session must use the configured tenant').toBe(
      config.tenantId
    );
    const actorId = Number(app.state?.user?.id);
    expect(
      Number.isSafeInteger(actorId) && actorId > 0,
      'Each session needs a valid cashier ID'
    ).toBe(true);
    return actorId;
  });

  expect(hasDistinctActorIds(actorIds, 3), 'Worker sessions must belong to distinct cashiers').toBe(
    true
  );
}
