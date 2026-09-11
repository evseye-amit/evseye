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

  it('rejects the console SMS provider in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        KYC_PROVIDER: 'live-provider',
        SMS_PROVIDER: 'console',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('SMS_PROVIDER must not use the console provider in production.');
  });
});
