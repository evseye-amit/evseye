export type RiderNameComponents = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** Normalizes configured rider name components without leaking UI keys into Prisma. */
export function normalizeRiderName(input: Record<string, unknown>, enabledFields?: string[]): RiderNameComponents {
  const explicit = {
    firstName: clean(input.first_name ?? input.firstName),
    middleName: clean(input.middle_name ?? input.middleName),
    lastName: clean(input.last_name ?? input.lastName),
  };
  const enabled = new Set((enabledFields ?? ['firstName', 'middleName', 'lastName']).map((field) => field.toLowerCase()));
  const words = clean(input.name).split(/\s+/).filter(Boolean);
  const hasExplicit = Object.values(explicit).some(Boolean);
  if (!hasExplicit && words.length) {
    if (enabled.has('middlename')) {
      explicit.firstName = words[0] ?? '';
      explicit.lastName = words.length > 1 ? words[words.length - 1] : '';
      explicit.middleName = words.length > 2 ? words.slice(1, -1).join(' ') : '';
    } else if (enabled.has('lastname')) {
      explicit.lastName = words.length > 1 ? words[words.length - 1] : '';
      explicit.firstName = words.slice(0, -1).join(' ') || words[0] || '';
    } else {
      explicit.firstName = words.join(' ');
    }
  }
  return {
    ...(enabled.has('firstname') && explicit.firstName ? { firstName: explicit.firstName } : {}),
    ...(enabled.has('middlename') && explicit.middleName ? { middleName: explicit.middleName } : {}),
    ...(enabled.has('lastname') && explicit.lastName ? { lastName: explicit.lastName } : {}),
  };
}

export function displayRiderName(components: RiderNameComponents, fallback = 'Rider') {
  const name = [components.firstName, components.middleName, components.lastName].filter(Boolean).join(' ').trim();
  return name || fallback;
}
