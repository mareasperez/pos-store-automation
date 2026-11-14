interface RuntimeDefaults {
  defaults?: { timeZone?: string };
}

function isTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function expenseTimeZone(
  tenantTimeZone: string | undefined,
  observedConfigs: readonly RuntimeDefaults[]
): string {
  if (isTimeZone(tenantTimeZone)) return tenantTimeZone;
  if (observedConfigs.length === 1 && isTimeZone(observedConfigs[0].defaults?.timeZone)) {
    return observedConfigs[0].defaults.timeZone;
  }
  throw new Error(
    'BLOCKED: a valid tenant time zone or uniquely observed runtime default is required; never guess report dates'
  );
}
