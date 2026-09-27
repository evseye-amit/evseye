import { describe, expect, it, vi } from 'vitest';
import { SandboxVerificationProvider } from './sandbox-verification.provider.js';

describe('Sandbox verification mapper', () => {
  it('normalizes PAN matches and discards vendor payload fields', async () => {
    const request = vi.fn().mockResolvedValue({ transaction_id: 'tx', data: { status: 'valid',
      pan: 'ABCDE1234F', name_as_per_pan_match: true, date_of_birth_match: true, secret: 'do-not-store' } });
    const provider = new SandboxVerificationProvider({ request } as never);
    const result = await provider.verify({ type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider',
      dateOfBirth: '01/01/2000', reason: 'Identity verification for rider onboarding' });
    expect(result.status).toBe('VERIFIED');
    expect(result.data).toEqual({ maskedPan: 'ABC****34F', panStatus: 'valid', nameMatch: true, dateOfBirthMatch: true });
    expect(JSON.stringify(result)).not.toContain('do-not-store');
  });

  it('rejects malformed provider data', async () => {
    const provider = new SandboxVerificationProvider({ request: vi.fn().mockResolvedValue({ data: {} }) } as never);
    await expect(provider.verify({ type: 'PAN_VERIFICATION', pan: 'ABCDE1234F', name: 'Test Rider',
      dateOfBirth: '01/01/2000', reason: 'Identity verification for rider onboarding' })).rejects.toThrow('PROVIDER_ERROR');
  });

  it('maps Aadhaar OTP response to safe identity fields', async () => {
    const provider = new SandboxVerificationProvider({ request: vi.fn().mockResolvedValue({ data: {
      status: 'VALID', name: 'Test Rider', year_of_birth: '2000', gender: 'M', photo: 'secret-photo', full_address: 'secret-address' } }) } as never);
    const result = await provider.completeAadhaarOtp('123456', '123456');
    expect(result.data).toEqual({ identityVerified: true });
    expect(JSON.stringify(result)).not.toContain('secret-photo');
  });
});
