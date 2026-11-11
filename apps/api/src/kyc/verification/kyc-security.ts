import { createHmac } from 'node:crypto';
import type { KycVerificationType } from '@prisma/client';

export function maskPan(value: string): string {
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

export function maskLastFour(value: string): string {
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export function fingerprint(secret: string, clientId: string, riderId: string, type: string, value: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([clientId, riderId, type, value.trim().toUpperCase()])).digest('hex');
}

export function idempotencyFingerprint(secret: string, clientId: string, key: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([clientId, 'IDEMPOTENCY_KEY', key])).digest('hex');
}

export function safeVerificationData(type: KycVerificationType, data: Record<string, string | boolean | null>): Record<string, string | boolean | null> {
  const string = (key: string) => typeof data[key] === 'string' ? data[key] as string : null;
  const boolean = (key: string) => typeof data[key] === 'boolean' ? data[key] as boolean : null;
  switch (type) {
    case 'PAN_VERIFICATION': return { maskedPan: string('maskedPan') ? maskPan(string('maskedPan')!) : null,
      panStatus: string('panStatus'), nameMatch: boolean('nameMatch'), dateOfBirthMatch: boolean('dateOfBirthMatch') };
    case 'AADHAAR_OTP': return { maskedAadhaar: string('maskedAadhaar') ? maskLastFour(string('maskedAadhaar')!) : null,
      identityVerified: boolean('identityVerified') };
    case 'BANK_ACCOUNT_VERIFICATION': return { maskedAccount: string('maskedAccount') ? maskLastFour(string('maskedAccount')!) : null,
      ifsc: string('ifsc'), accountExists: boolean('accountExists') };
    case 'IFSC_VERIFICATION': return { ifsc: string('ifsc'), bank: string('bank'), branch: string('branch') };
    default: return {};
  }
}
