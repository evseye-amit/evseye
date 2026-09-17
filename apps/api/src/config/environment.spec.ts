import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  it('rejects the sandbox KYC provider in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        KYC_PROVIDER: 'sandbox',
        S3_BUCKET: 'evs-eye-production',
        MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.io',
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
        S3_BUCKET: 'evs-eye-production',
        MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.io',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('SMS_PROVIDER must not use the console provider in production.');
  });

  it('requires a private object storage bucket in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        KYC_PROVIDER: 'live-provider',
        SMS_PROVIDER: 'live-provider',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('S3_BUCKET must be configured in production.');
  });

  it('requires a public delivery origin for public assets in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        KYC_PROVIDER: 'live-provider',
        SMS_PROVIDER: 'live-provider',
        S3_BUCKET: 'evs-eye-production',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('MEDIA_PUBLIC_BASE_URL must be configured in production');
  });

  it('validates the global API rate-limit settings', () => {
    expect(() =>
      validateEnvironment({
        API_RATE_LIMIT: '0',
      }),
    ).toThrow();
    expect(() =>
      validateEnvironment({
        API_RATE_TTL_MS: '999',
      }),
    ).toThrow();
  });
});
