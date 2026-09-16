import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  it('rejects the sandbox KYC provider in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        OBJECT_STORAGE_DRIVER: 's3',
        KYC_PROVIDER: 'sandbox',
        S3_BUCKET: 'evs-eye-production',
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
        OBJECT_STORAGE_DRIVER: 's3',
        KYC_PROVIDER: 'live-provider',
        SMS_PROVIDER: 'console',
        S3_BUCKET: 'evs-eye-production',
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

  it('rejects local object storage in production even when a bucket is present', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        OBJECT_STORAGE_DRIVER: 'local',
        S3_BUCKET: 'evs-eye-production',
        KYC_PROVIDER: 'live-provider',
        SMS_PROVIDER: 'live-provider',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        OTP_HASH_SECRET: 'c'.repeat(40),
      }),
    ).toThrow('OBJECT_STORAGE_DRIVER must be s3 in production.');
  });

  it('defaults development object storage to a private local root', () => {
    expect(validateEnvironment({}).OBJECT_STORAGE_DRIVER).toBe('local');
    expect(validateEnvironment({}).LOCAL_STORAGE_ROOT).toBe('.local-storage');
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
