import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  it('rejects the sandbox KYC provider in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        KYC_PROVIDER: 'sandbox',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('KYC_PROVIDER must not use the sandbox in production.');
  });
});
