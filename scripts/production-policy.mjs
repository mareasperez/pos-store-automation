const safeProductionSpecs = new Set([
  'tests/smoke/api.spec.ts',
  'tests/smoke/landing.spec.ts',
  'tests/smoke/tenant-isolation.spec.ts',
]);
const valueOptions = new Set([
  '--grep',
  '--project',
  '--workers',
  '-j',
  '--reporter',
  '--output',
  '--timeout',
  '--global-timeout',
  '--retries',
]);
const booleanOptions = new Set(['--headed', '--headless', '--list']);

export function assertProductionTenant(environment) {
  if (environment.E2E_ALLOW_PROD !== 'true') {
    throw new Error(
      '[e2e] Production runs are blocked by default. Set E2E_ALLOW_PROD=true for the approved sandbox tenant.'
    );
  }

  const configuredTenant = environment.TEST_TENANT_ID || environment.E2E_TENANT_ID;
  if (
    !environment.E2E_PROD_TEST_TENANT_ID ||
    configuredTenant !== environment.E2E_PROD_TEST_TENANT_ID
  ) {
    throw new Error(
      '[e2e] Production runs require TEST_TENANT_ID/E2E_TENANT_ID to equal E2E_PROD_TEST_TENANT_ID.'
    );
  }
}

function parseProductionArgs(args) {
  const specs = [];
  const greps = [];
  const projects = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.includes('=')) {
      const separator = argument.indexOf('=');
      const option = argument.slice(0, separator);
      const value = argument.slice(separator + 1);
      if (!valueOptions.has(option) || !value) {
        throw new Error(
          '[e2e] Production does not allow unrecognized or selector-changing arguments.'
        );
      }
      if (option === '--grep') greps.push(value);
      if (option === '--project') projects.push(value);
      continue;
    }

    if (argument.startsWith('-')) {
      if (booleanOptions.has(argument)) continue;
      if (!valueOptions.has(argument)) {
        throw new Error(
          '[e2e] Production does not allow unrecognized or selector-changing arguments.'
        );
      }
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`[e2e] Production option ${argument} requires a value.`);
      }
      if (argument === '--grep') greps.push(value);
      if (argument === '--project') projects.push(value);
      index += 1;
      continue;
    }

    const spec = argument.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!safeProductionSpecs.has(spec)) {
      throw new Error(
        '[e2e] Production only accepts explicitly selected approved read-only smoke specs.'
      );
    }
    specs.push(spec);
  }

  return { specs, greps, projects };
}

export function assertProductionRunAllowed(environment, args) {
  assertProductionTenant(environment);

  const { specs, greps, projects } = parseProductionArgs(args);

  if (
    specs.length === 0 ||
    greps.length !== 1 ||
    greps[0] !== '@smoke' ||
    projects.some(
      (project) => !['chromium-authenticated', 'chromium-unauthenticated'].includes(project)
    )
  ) {
    throw new Error(
      '[e2e] Production is restricted to explicitly selected approved read-only smoke specs with --grep @smoke.'
    );
  }
}
