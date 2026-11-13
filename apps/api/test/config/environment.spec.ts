import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../../src/config/environment.js';

describe('validateEnvironment', () => {
  it('allows the Sandbox provider in production while KYC is disabled', () => {
    expect(validateEnvironment({
      NODE_ENV: 'production',
      KYC_PROVIDER: 'sandbox',
      SMS_PROVIDER: 'telipia',
      TELIPIA_API_URL: 'https://sms.example.com/api',
      TELIPIA_USERNAME: 'user',
      TELIPIA_API_KEY: 'key',
      TELIPIA_SENDER: 'SENDER',
      TELIPIA_LOGIN_TEMPLATE_ID: 'template',
      S3_BUCKET: 'evs-eye-production',
      MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.io',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      OTP_HASH_SECRET: 'c'.repeat(40),
      CLIENT_PROXY_SECRET: 'd'.repeat(40),
      DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/evseye',
      APP_BASE_DOMAINS: 'evseye.com',
      APP_GENERIC_HOSTS: 'app.evseye.com,api.evseye.com',
      CORS_ORIGINS: 'https://app.evseye.com',
    }).KYC_PROVIDER).toBe('sandbox');
  });

  it('requires Sandbox production mode when KYC is enabled in production', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'production',
      KYC_PROVIDER: 'sandbox',
      KYC_ENABLED: 'true',
      KYC_SANDBOX_ENVIRONMENT: 'TEST',
      KYC_SANDBOX_API_KEY: 'key',
      KYC_SANDBOX_API_SECRET: 'secret',
      KYC_FINGERPRINT_SECRET: 'f'.repeat(32),
      S3_BUCKET: 'evs-eye-production',
      MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.io',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      OTP_HASH_SECRET: 'c'.repeat(40),
    })).toThrow('Production KYC requires Sandbox PRODUCTION credentials.');
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
  it('requires Telipia settings when staging live SMS is enabled', () => {
    expect(() => validateEnvironment({ STAGING_LIVE_SMS_ENABLED: 'true' })).toThrow('Telipia SMS configuration is missing');
    expect(validateEnvironment({
      STAGING_LIVE_SMS_ENABLED: 'true',
      TELIPIA_API_URL: 'https://telipiacloud.in/sms-panel/api/http/index.php',
      TELIPIA_USERNAME: 'account',
      TELIPIA_API_KEY: 'key',
      TELIPIA_SENDER: 'EVSPRS',
      TELIPIA_LOGIN_TEMPLATE_ID: 'template',
    }).STAGING_LIVE_SMS_ENABLED).toBe(true);
  });
  it('does not allow the staging SMS switch in production', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'production',
      STAGING_LIVE_SMS_ENABLED: 'true',
      KYC_PROVIDER: 'live-provider',
      SMS_PROVIDER: 'telipia',
      TELIPIA_API_URL: 'https://telipiacloud.in/sms-panel/api/http/index.php',
      TELIPIA_USERNAME: 'account',
      TELIPIA_API_KEY: 'key',
      TELIPIA_SENDER: 'EVSPRS',
      TELIPIA_LOGIN_TEMPLATE_ID: 'template',
      S3_BUCKET: 'evseye-production',
      MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.com',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      OTP_HASH_SECRET: 'c'.repeat(40),
      CLIENT_PROXY_SECRET: 'd'.repeat(40),
    })).toThrow('STAGING_LIVE_SMS_ENABLED must not be enabled in production.');
  });
  it('rejects the console fallback provider in production', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'production',
      KYC_PROVIDER: 'live-provider',
      SMS_PROVIDER: 'telipia',
      SMS_FALLBACK_PROVIDER: 'console',
      TELIPIA_API_URL: 'https://sms.example.com/api',
      TELIPIA_USERNAME: 'user',
      TELIPIA_API_KEY: 'key',
      TELIPIA_SENDER: 'SENDER',
      TELIPIA_LOGIN_TEMPLATE_ID: 'template',
      S3_BUCKET: 'evs-eye-production',
      MEDIA_PUBLIC_BASE_URL: 'https://media.evseye.com',
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      OTP_HASH_SECRET: 'c'.repeat(40),
      CLIENT_PROXY_SECRET: 'd'.repeat(40),
    })).toThrow('SMS_FALLBACK_PROVIDER must not use the console provider in production.');
  });
  it('requires a verified sender domain and login URL for MSG91 email', () => {
    expect(() => validateEnvironment({ EMAIL_PROVIDER: 'msg91' })).toThrow('MSG91 email configuration is missing');
    expect(() => validateEnvironment({ EMAIL_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'test-key', MSG91_EMAIL_DOMAIN: 'mail.evseye.com', MSG91_EMAIL_FROM: 'no-reply@other.example', MSG91_WELCOME_TEMPLATE_ID: 'welcome_client_mail', CLIENT_LOGIN_URL: 'https://app.evseye.com/' })).toThrow('MSG91_EMAIL_FROM must use MSG91_EMAIL_DOMAIN');
  });
});

describe('independent AutoPay provider configuration', () => {
  it('preserves the configured provider and disables Razorpay AutoPay by default', () => {
    const settings = validateEnvironment({});
    expect(settings.AUTOPAY_PROVIDER).toBe('configured');
    expect(settings.RAZORPAY_AUTOPAY_ENABLED).toBe('false');
    expect(() => validateEnvironment({ AUTOPAY_PROVIDER: 'razorpay' })).toThrow('AutoPay requires');
  });
  it('defers missing Cashfree credentials to payment request time', () => {
    expect(validateEnvironment({ PAYMENT_PROVIDER: 'disabled', AUTOPAY_PROVIDER: 'cashfree' }).CASHFREE_CLIENT_ID).toBeUndefined();
  });
});
