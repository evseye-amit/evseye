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
        SMS_PROVIDER: 'telipia',
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
        SMS_PROVIDER: 'telipia',
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

describe('client deployment configuration', () => {
  it('rejects malformed configured base domains', () => {
    expect(() => validateEnvironment({ APP_BASE_DOMAINS: 'https://example.com/path' })).toThrow();
    expect(() => validateEnvironment({ APP_BASE_DOMAINS: 'example.com:443' })).toThrow();
    expect(validateEnvironment({ APP_BASE_DOMAINS: 'example.com,localhost' }).APP_BASE_DOMAINS).toBe('example.com,localhost');
  });
  it('rejects shared production signing secrets', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production', S3_BUCKET: 'private', MEDIA_PUBLIC_BASE_URL: 'https://media.example.com', KYC_PROVIDER: 'live', SMS_PROVIDER: 'telipia', TELIPIA_API_URL: 'https://sms.example.com/api', TELIPIA_USERNAME: 'user', TELIPIA_API_KEY: 'key', TELIPIA_SENDER: 'SENDER', TELIPIA_LOGIN_TEMPLATE_ID: 'template', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'a'.repeat(40), OTP_HASH_SECRET: 'c'.repeat(40), CLIENT_PROXY_SECRET: 'd'.repeat(40) })).toThrow('must be distinct');
  });
  it('requires complete HTTPS settings when Telipia is selected', () => {
    expect(() => validateEnvironment({ SMS_PROVIDER: 'telipia' })).toThrow('Telipia SMS configuration is missing');
    expect(() => validateEnvironment({ SMS_PROVIDER: 'telipia', TELIPIA_API_URL: 'http://sms.example.com/api', TELIPIA_USERNAME: 'user', TELIPIA_API_KEY: 'key', TELIPIA_SENDER: 'SENDER', TELIPIA_LOGIN_TEMPLATE_ID: 'template' })).toThrow('TELIPIA_API_URL must use HTTPS');
  });
  it('requires a verified sender domain and login URL for MSG91 email', () => {
    expect(() => validateEnvironment({ EMAIL_PROVIDER: 'msg91' })).toThrow('MSG91 email configuration is missing');
    expect(() => validateEnvironment({ EMAIL_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'test-key', MSG91_EMAIL_DOMAIN: 'mail.evseye.com', MSG91_EMAIL_FROM: 'no-reply@other.example', MSG91_WELCOME_TEMPLATE_ID: 'welcome_client_mail', CLIENT_LOGIN_URL: 'https://app.evseye.com/' })).toThrow('MSG91_EMAIL_FROM must use MSG91_EMAIL_DOMAIN');
  });
});
