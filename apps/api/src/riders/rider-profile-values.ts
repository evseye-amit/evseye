/** Date-only values support both formats accepted by onboarding, without timezone conversion. */
export function profileBirthDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(text);
  const display = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!iso && !display) return null;
  const year = Number(iso?.[1] ?? display?.[3]), month = Number(iso?.[2] ?? display?.[2]), day = Number(iso?.[3] ?? display?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

export const profileAddressFields: Record<string, string> = {
  DATE_OF_BIRTH: 'dateOfBirth', ADDRESS: 'address', ADDRESS_LINE1: 'addressLine1', ADDRESS_LINE2: 'addressLine2',
  CITY: 'city', STATE: 'state', POSTAL_CODE: 'postalCode',
  CURRENT_ADDRESS: 'currentAddress', CURRENT_ADDRESS_LINE1: 'currentAddressLine1', CURRENT_ADDRESS_LINE2: 'currentAddressLine2',
  CURRENT_ADDRESS_CITY: 'currentAddressCity', CURRENT_ADDRESS_STATE: 'currentAddressState', CURRENT_ADDRESS_PINCODE: 'currentAddressPincode',
  PERMANENT_ADDRESS: 'permanentAddress', PERMANENT_ADDRESS_LINE1: 'permanentAddressLine1', PERMANENT_ADDRESS_LINE2: 'permanentAddressLine2',
  PERMANENT_ADDRESS_CITY: 'permanentAddressCity', PERMANENT_ADDRESS_STATE: 'permanentAddressState', PERMANENT_ADDRESS_PINCODE: 'permanentAddressPincode',
  SAME_AS_CURRENT_ADDRESS: 'sameAsCurrentAddress',
};
export const recoverableProfileKeys = new Set(Object.values(profileAddressFields).flatMap(key => [key, `metadata.${key}`]));
