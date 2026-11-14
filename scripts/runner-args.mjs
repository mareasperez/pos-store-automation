const environments = new Set(['local', 'dev', 'qa', 'staging', 'prod']);

export function parseRunnerArgs(rawArgs, defaultEnvironment = 'local') {
  const args = [...rawArgs];
  const environmentFlags = args.filter(
    (argument) => argument === '--env' || argument.startsWith('--env=')
  );
  const positionalEnvironment = environments.has(args[0]?.toLowerCase());

  if (environmentFlags.length > 1 || (environmentFlags.length > 0 && positionalEnvironment)) {
    throw new Error(
      '[e2e] Specify the environment once, using --env or the legacy positional form.'
    );
  }

  if (environmentFlags.length === 1) {
    const flag = environmentFlags[0];
    let environment;
    let flagIndex;

    if (flag === '--env') {
      flagIndex = args.indexOf(flag);
      environment = args[flagIndex + 1];
      if (!environment || environment.startsWith('-')) {
        throw new Error('[e2e] --env requires a value: local, dev, qa, staging, or prod.');
      }
      args.splice(flagIndex, 2);
    } else {
      flagIndex = args.indexOf(flag);
      environment = flag.slice('--env='.length);
      if (!environment) {
        throw new Error('[e2e] --env requires a value: local, dev, qa, staging, or prod.');
      }
      args.splice(flagIndex, 1);
    }

    return { environment, args };
  }

  if (positionalEnvironment) {
    return { environment: args[0].toLowerCase(), args: args.slice(1) };
  }

  return { environment: defaultEnvironment, args };
}
