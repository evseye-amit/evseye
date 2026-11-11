import { describe, expect, it } from 'vitest';
import { AUTH_ERROR_CODES } from '../../src/auth/auth-error-codes.js';

describe('auth error contract', () => {
  it('contains unique OTP and session lifecycle codes', () => {
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
    expect(AUTH_ERROR_CODES).toContain('OTP_EXPIRED');
    expect(AUTH_ERROR_CODES).toContain('SESSION_REVOKED');
  });
});
