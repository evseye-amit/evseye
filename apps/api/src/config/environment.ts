import { z } from 'zod';
import { normalizeHostname } from '../client-identity/hostname.js';
const hostList = z.string().refine(value => {
  try { return value.split(',').every(host => host.trim() === normalizeHostname(host.trim()) && !host.includes(':')); } catch { return false; }
}, 'Use comma-separated lowercase hostnames without schemes, paths or ports.');

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  APP_BASE_DOMAINS: hostList.default('localhost'),
  APP_GENERIC_HOSTS: hostList.default('localhost,127.0.0.1'),
  CLIENT_PROXY_SECRET: z.string().min(32).optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('development-access-secret-change-me-123'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default('development-refresh-secret-change-me-123'),
  OTP_HASH_SECRET: z
    .string()
    .min(32)
    .default('development-otp-hash-secret-change-me-123'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  API_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(120),
  API_RATE_TTL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  IOT_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(60),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  // CDN/origin URL used only for public, non-sensitive assets such as OEM logos.
  MEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(['AES256', 'aws:kms']).optional(),
  S3_SIGNED_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(300),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['disabled', 'msg91']).default('disabled'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_EMAIL_DOMAIN: z.string().optional(),
  MSG91_EMAIL_FROM: z.string().email().optional(),
  MSG91_WELCOME_TEMPLATE_ID: z.string().optional(),
  CLIENT_LOGIN_URL: z.string().url().refine((value) => /^https?:\/\//.test(value), 'Must use HTTP or HTTPS').optional(),
  SMS_PROVIDER: z.enum(['console', 'telipia']).default('console'),
  TELIPIA_API_URL: z.string().url().optional(),
  TELIPIA_USERNAME: z.string().optional(),
  TELIPIA_API_KEY: z.string().optional(),
  TELIPIA_SENDER: z.string().optional(),
  TELIPIA_ROUTE: z.string().default('TRANS'),
  TELIPIA_LOGIN_TEMPLATE_ID: z.string().optional(),
  TELIPIA_DEALLOCATION_TEMPLATE_ID: z.string().optional(),
  KYC_PROVIDER: z.string().default('sandbox'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration: ${result.error.message}`,
    );
  }

  if (
    result.data.NODE_ENV === 'production' &&
    (result.data.JWT_ACCESS_SECRET.includes('change-me') ||
      result.data.JWT_REFRESH_SECRET.includes('change-me') ||
      result.data.OTP_HASH_SECRET.includes('change-me'))
  ) {
    throw new Error(
      'JWT secrets must be replaced before running in production.',
    );
  }
  if (result.data.NODE_ENV === 'production' && !result.data.S3_BUCKET) {
    throw new Error('S3_BUCKET must be configured in production.');
  }
  if (
    result.data.NODE_ENV === 'production' &&
    !result.data.MEDIA_PUBLIC_BASE_URL
  ) {
    throw new Error(
      'MEDIA_PUBLIC_BASE_URL must be configured in production for public media delivery.',
    );
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.KYC_PROVIDER === 'sandbox'
  ) {
    throw new Error('KYC_PROVIDER must not use the sandbox in production.');
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.SMS_PROVIDER === 'console'
  ) {
    throw new Error(
      'SMS_PROVIDER must not use the console provider in production.',
    );
  }
  if (result.data.SMS_PROVIDER === 'telipia') {
    const required = ['TELIPIA_API_URL', 'TELIPIA_USERNAME', 'TELIPIA_API_KEY', 'TELIPIA_SENDER', 'TELIPIA_LOGIN_TEMPLATE_ID'] as const;
    const missing = required.filter((key) => !result.data[key]?.trim());
    if (missing.length) throw new Error(`Telipia SMS configuration is missing: ${missing.join(', ')}.`);
    if (new URL(result.data.TELIPIA_API_URL!).protocol !== 'https:') {
      throw new Error('TELIPIA_API_URL must use HTTPS.');
    }
  }

  if (result.data.NODE_ENV === 'production' && (!result.data.CLIENT_PROXY_SECRET || result.data.CLIENT_PROXY_SECRET.includes('development'))) {
    throw new Error('Configure a random CLIENT_PROXY_SECRET for the client gateway in production.');
  }
  if (result.data.NODE_ENV === 'production') {
    const secrets = [result.data.JWT_ACCESS_SECRET, result.data.JWT_REFRESH_SECRET, result.data.OTP_HASH_SECRET, result.data.CLIENT_PROXY_SECRET];
    if (new Set(secrets).size !== secrets.length) throw new Error('Production authentication and gateway secrets must be distinct.');
    const hosts = `${result.data.APP_BASE_DOMAINS},${result.data.APP_GENERIC_HOSTS}`.split(',');
    if (hosts.some(host => host.includes('localhost') || /^\d+(\.\d+){3}$/.test(host))) throw new Error('Configure public application hostnames in production.');
    for (const origin of result.data.CORS_ORIGINS.split(',')) {
      const url = new URL(origin.trim());
      if (url.protocol !== 'https:' || url.origin !== origin.trim()) throw new Error('Production CORS origins must be exact HTTPS origins.');
    }
    if (!result.data.DATABASE_URL) throw new Error('DATABASE_URL is required in production.');
  }
  return result.data;
}
