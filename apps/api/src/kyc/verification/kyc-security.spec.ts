import { describe, expect, it } from 'vitest';
import { fingerprint, idempotencyFingerprint, maskLastFour, maskPan, safeVerificationData } from './kyc-security.js';

describe('KYC sensitive data', () => {
  it('uses a keyed and client-scoped fingerprint', () => {
    const key = 'a'.repeat(32);
    const first = fingerprint(key, 'client-a', 'rider-a', 'PAN_VERIFICATION', ' ABCDE1234F ');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(fingerprint(key, 'client-a', 'rider-a', 'PAN_VERIFICATION', 'abcde1234f'));
    expect(first).not.toBe(fingerprint(key, 'client-b', 'rider-a', 'PAN_VERIFICATION', 'ABCDE1234F'));
    expect(idempotencyFingerprint(key, 'client-a', 'request-123')).not.toContain('request-123');
  });

  it('masks document numbers and never exposes complete values through normalized data', () => {
    expect(maskPan('ABCDE1234F')).toBe('ABC****34F');
    expect(maskLastFour('123456789012')).toBe('********9012');
    expect(safeVerificationData('PAN_VERIFICATION', { maskedPan: 'ABCDE1234F', rawAccount: '123456789012' }))
      .toEqual({ maskedPan: 'ABC****34F', panStatus: null, nameMatch: null, dateOfBirthMatch: null });
    expect(safeVerificationData('AADHAAR_OTP', { maskedAadhaar: '123456789012', photo: 'secret-photo' }))
      .toEqual({ maskedAadhaar: '********9012', identityVerified: null });
    expect(safeVerificationData('BANK_ACCOUNT_VERIFICATION', { maskedAccount: '123456789012', nameAtBank: 'Secret Name' }))
      .toEqual({ maskedAccount: '********9012', ifsc: null, accountExists: null });
  });
});
