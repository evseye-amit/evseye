/** Normalizes Indian mobile input for new user records. */
export function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local =
    /^\d{10}$/.test(digits)
      ? digits
      : /^0(\d{10})$/.exec(digits)?.[1] ??
        /^91(\d{10})$/.exec(digits)?.[1];
  return local && /^[6-9]\d{9}$/.test(local) ? `+91${local}` : value.trim();
}

/** Finds legacy and canonical representations of the same Indian mobile. */
export function indianMobileVariants(value: string): string[] {
  const normalized = normalizeIndianMobile(value);
  const local = /^\+91([6-9]\d{9})$/.exec(normalized)?.[1];
  return local
    ? [...new Set([normalized, `0${local}`, local, value.trim()])]
    : [value.trim()];
}
