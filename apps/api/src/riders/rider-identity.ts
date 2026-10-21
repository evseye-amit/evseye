import { ConflictException } from '@nestjs/common';

export type RiderIdentityKind = 'AADHAAR' | 'PAN';
export type RiderIdentityValues = Partial<Record<RiderIdentityKind, string>>;

const identityFields = {
  AADHAAR: { fieldCode: 'AADHAAR_NUMBER', metadataKey: 'aadhaarNumber', label: 'Aadhaar number' },
  PAN: { fieldCode: 'PAN_NUMBER', metadataKey: 'panNumber', label: 'PAN number' },
} as const satisfies Record<RiderIdentityKind, { fieldCode: string; metadataKey: string; label: string }>;

export class RiderIdentityConflictException extends ConflictException {
  readonly fieldCode: 'AADHAAR_NUMBER' | 'PAN_NUMBER';

  constructor(kind: RiderIdentityKind) {
    const field = identityFields[kind];
    super(`${field.label} is already registered for another rider in this client.`);
    this.fieldCode = field.fieldCode;
  }
}

export function canonicalizeRiderIdentity(kind: RiderIdentityKind, value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return kind === 'PAN' ? normalized.toUpperCase() : normalized;
}

export function normalizeRiderIdentityInput(values: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...values };
  for (const kind of Object.keys(identityFields) as RiderIdentityKind[]) {
    const { fieldCode } = identityFields[kind];
    if (Object.prototype.hasOwnProperty.call(values, fieldCode)) {
      normalized[fieldCode] = canonicalizeRiderIdentity(kind, values[fieldCode]) ?? '';
    }
  }
  return normalized;
}

export function riderIdentityValuesFromMetadata(metadata: unknown): RiderIdentityValues {
  const record = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const result: RiderIdentityValues = {};
  for (const kind of Object.keys(identityFields) as RiderIdentityKind[]) {
    const value = canonicalizeRiderIdentity(kind, record[identityFields[kind].metadataKey]);
    if (value) result[kind] = value;
  }
  return result;
}

export function riderIdentityConflictField(error: unknown): 'AADHAAR_NUMBER' | 'PAN_NUMBER' | undefined {
  if (error instanceof RiderIdentityConflictException) return error.fieldCode;
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') return undefined;
  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta as Record<string, unknown> : {};
  const target = Array.isArray(meta.target)
    ? meta.target.filter((value): value is string => typeof value === 'string').join('.')
    : String(meta.target ?? meta.constraint ?? '');
  if (/aadhaar/i.test(target)) return 'AADHAAR_NUMBER';
  if (/pan/i.test(target)) return 'PAN_NUMBER';
  return undefined;
}

export function riderIdentityConflictException(error: unknown): RiderIdentityConflictException | undefined {
  const fieldCode = riderIdentityConflictField(error);
  if (!fieldCode) return undefined;
  return new RiderIdentityConflictException(fieldCode === 'PAN_NUMBER' ? 'PAN' : 'AADHAAR');
}
