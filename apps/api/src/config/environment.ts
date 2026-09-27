import { z } from 'zod';
import { normalizeHostname } from '../client-identity/hostname.js';
const hostList = z.string().refine((value) => {
  try {
    return value
      .split(',')
      .every(
        (host) =>
          host.trim() === normalizeHostname(host.trim()) && !host.includes(':'),
      );
  } catch {
    return false;
  }
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
  NEAREST_HUB_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  NEAREST_HUB_RADIUS_STEPS_KM: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .default('5,10,25,50'),
  NEAREST_HUB_MAX_RADIUS_KM: z.coerce.number().positive().max(100).default(50),
  NEAREST_HUB_CANDIDATE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .default(10),
  NEAREST_HUB_RESULT_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  ROUTING_PROVIDER_ORDER: z
    .string()
    .regex(/^(GOOGLE|MAPBOX)(,(GOOGLE|MAPBOX))?$/)
    .default('GOOGLE,MAPBOX'),
  GOOGLE_ROUTES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  GOOGLE_ROUTES_API_KEY: z.string().optional(),
  GOOGLE_ROUTES_MONTHLY_LIMIT: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(12000),
  GOOGLE_ROUTES_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  MAPBOX_ROUTES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  MAPBOX_ROUTES_MONTHLY_LIMIT: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(15000),
  MAPBOX_ROUTES_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ROUTING_CACHE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ROUTING_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ROUTING_QUOTA_TIMEZONE: z.string().default('Asia/Kolkata'),
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
  CLIENT_LOGIN_URL: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value), 'Must use HTTP or HTTPS')
    .optional(),
  SMS_PROVIDER: z.enum(['console', 'telipia']).default('console'),
  TELIPIA_API_URL: z.string().url().optional(),
  TELIPIA_USERNAME: z.string().optional(),
  TELIPIA_API_KEY: z.string().optional(),
  TELIPIA_SENDER: z.string().optional(),
  TELIPIA_ROUTE: z.string().default('TRANS'),
  TELIPIA_LOGIN_TEMPLATE_ID: z.string().optional(),
  TELIPIA_DEALLOCATION_TEMPLATE_ID: z.string().optional(),
  KYC_PROVIDER: z.string().default('sandbox'),
  KYC_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  KYC_SANDBOX_ENVIRONMENT: z.enum(['TEST']).default('TEST'),
  KYC_SANDBOX_SECRET_REFERENCE: z.literal('env:KYC_SANDBOX_TEST').default('env:KYC_SANDBOX_TEST'),
  KYC_SANDBOX_API_KEY: z.string().optional(),
  KYC_SANDBOX_API_SECRET: z.string().optional(),
  KYC_FINGERPRINT_SECRET: z.string().min(32).optional(),
  KYC_OPS_STUCK_PROCESSING_MINUTES: z.coerce.number().int().min(1).max(10080).default(10),
  KYC_OPS_STUCK_PROVIDER_MINUTES: z.coerce.number().int().min(1).max(10080).default(5),
  KYC_OPS_ACTION_REQUIRED_MINUTES: z.coerce.number().int().min(1).max(43200).default(1440),
  KYC_OPS_REVIEW_SLA_MINUTES: z.coerce.number().int().min(1).max(43200).default(240),
  KYC_OPS_ALERT_MIN_SAMPLES: z.coerce.number().int().min(1).max(10000).default(20),
  KYC_OPS_ALERT_TECHNICAL_RATE_PERCENT: z.coerce.number().min(1).max(100).default(25),
  KYC_OPS_MAX_TECHNICAL_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  KYC_ANALYTICS_MIN_SAMPLE_SIZE: z.coerce.number().int().min(1).max(100000).default(30),
  KYC_ROUTING_DEADLINE_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  PAYMENT_PROVIDER: z
    .enum(['disabled', 'cashfree', 'mock'])
    .default('disabled'),
  CASHFREE_ENVIRONMENT: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  CASHFREE_CLIENT_ID: z.string().optional(),
  CASHFREE_CLIENT_SECRET: z.string().optional(),
  CASHFREE_WEBHOOK_SECRET: z.string().optional(),
  CASHFREE_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default('2025-01-01'),
  CASHFREE_SUBSCRIPTION_RETURN_URL: z.string().url().optional(),
  CASHFREE_WEBHOOK_URL: z.string().url().optional(),
  CASHFREE_PG_WEBHOOK_URL: z.string().url().optional(),
  CASHFREE_PG_WEBHOOK_SECRET: z.string().optional(),
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
  if (
    result.data.ROUTING_PROVIDER_ORDER.split(',').length !==
    new Set(result.data.ROUTING_PROVIDER_ORDER.split(',')).size
  )
    throw new Error('ROUTING_PROVIDER_ORDER has duplicate providers.');
  const radii = result.data.NEAREST_HUB_RADIUS_STEPS_KM.split(',').map(Number);
  if (
    radii.some(
      (radius, index) =>
        radius <= 0 || (index > 0 && radius <= radii[index - 1]),
    ) ||
    radii.at(-1)! < result.data.NEAREST_HUB_MAX_RADIUS_KM
  )
    throw new Error(
      'Nearest hub radius steps must increase and reach the maximum radius.',
    );
  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: result.data.ROUTING_QUOTA_TIMEZONE,
    });
  } catch {
    throw new Error('Invalid ROUTING_QUOTA_TIMEZONE.');
  }
  if (
    result.data.NEAREST_HUB_RESULT_LIMIT >
    result.data.NEAREST_HUB_CANDIDATE_LIMIT
  )
    throw new Error('Nearest hub result limit exceeds candidate limit.');
  if (
    (result.data.GOOGLE_ROUTES_ENABLED && !result.data.GOOGLE_ROUTES_API_KEY) ||
    (result.data.MAPBOX_ROUTES_ENABLED && !result.data.MAPBOX_ACCESS_TOKEN)
  )
    throw new Error('Enabled routing provider lacks credentials.');
  if (
    (result.data.GOOGLE_ROUTES_ENABLED || result.data.MAPBOX_ROUTES_ENABLED) &&
    !result.data.REDIS_URL
  )
    throw new Error('REDIS_URL is required when external routing is enabled.');
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
  if (result.data.KYC_ENABLED && (!result.data.KYC_SANDBOX_API_KEY || !result.data.KYC_SANDBOX_API_SECRET || !result.data.KYC_FINGERPRINT_SECRET)) {
    throw new Error('Enabled KYC requires Sandbox TEST credentials and a fingerprint secret.');
  }
  if (result.data.NODE_ENV === 'production' && result.data.KYC_ENABLED) {
    throw new Error('Phase 1 KYC TEST integration cannot run in production.');
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
    const required = [
      'TELIPIA_API_URL',
      'TELIPIA_USERNAME',
      'TELIPIA_API_KEY',
      'TELIPIA_SENDER',
      'TELIPIA_LOGIN_TEMPLATE_ID',
    ] as const;
    const missing = required.filter((key) => !result.data[key]?.trim());
    if (missing.length)
      throw new Error(
        `Telipia SMS configuration is missing: ${missing.join(', ')}.`,
      );
    if (new URL(result.data.TELIPIA_API_URL!).protocol !== 'https:') {
      throw new Error('TELIPIA_API_URL must use HTTPS.');
    }
  }
  if (result.data.EMAIL_PROVIDER === 'msg91') {
    const required = [
      'MSG91_AUTH_KEY',
      'MSG91_EMAIL_DOMAIN',
      'MSG91_EMAIL_FROM',
      'MSG91_WELCOME_TEMPLATE_ID',
      'CLIENT_LOGIN_URL',
    ] as const;
    const missing = required.filter((key) => !result.data[key]?.trim());
    if (missing.length)
      throw new Error(
        `MSG91 email configuration is missing: ${missing.join(', ')}.`,
      );
    if (
      result.data.MSG91_EMAIL_FROM!.split('@')[1]?.toLowerCase() !==
      result.data.MSG91_EMAIL_DOMAIN!.toLowerCase()
    ) {
      throw new Error('MSG91_EMAIL_FROM must use MSG91_EMAIL_DOMAIN.');
    }
    if (
      result.data.NODE_ENV === 'production' &&
      new URL(result.data.CLIENT_LOGIN_URL!).protocol !== 'https:'
    ) {
      throw new Error('CLIENT_LOGIN_URL must use HTTPS in production.');
    }
  }
  if (result.data.PAYMENT_PROVIDER === 'cashfree') {
    const required = [
      'CASHFREE_CLIENT_ID',
      'CASHFREE_CLIENT_SECRET',
      'CASHFREE_WEBHOOK_SECRET',
      'CASHFREE_SUBSCRIPTION_RETURN_URL',
      'CASHFREE_WEBHOOK_URL',
      'CASHFREE_PG_WEBHOOK_URL',
    ] as const;
    const missing = required.filter((key) => !result.data[key]?.trim());
    if (missing.length)
      throw new Error(
        `Cashfree configuration is missing: ${missing.join(', ')}.`,
      );
    if (result.data.NODE_ENV === 'production') {
      if (result.data.CASHFREE_ENVIRONMENT !== 'PRODUCTION')
        throw new Error(
          'Cashfree production deployment requires CASHFREE_ENVIRONMENT=PRODUCTION.',
        );
      for (const key of [
        'CASHFREE_SUBSCRIPTION_RETURN_URL',
        'CASHFREE_WEBHOOK_URL',
        'CASHFREE_PG_WEBHOOK_URL',
      ] as const) {
        if (new URL(result.data[key]!).protocol !== 'https:')
          throw new Error(`${key} must use HTTPS in production.`);
      }
    }
  }
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.PAYMENT_PROVIDER === 'mock'
  ) {
    throw new Error('Mock payment provider is not allowed in production.');
  }

  if (
    result.data.NODE_ENV === 'production' &&
    (!result.data.CLIENT_PROXY_SECRET ||
      result.data.CLIENT_PROXY_SECRET.includes('development'))
  ) {
    throw new Error(
      'Configure a random CLIENT_PROXY_SECRET for the client gateway in production.',
    );
  }
  if (result.data.NODE_ENV === 'production') {
    const secrets = [
      result.data.JWT_ACCESS_SECRET,
      result.data.JWT_REFRESH_SECRET,
      result.data.OTP_HASH_SECRET,
      result.data.CLIENT_PROXY_SECRET,
    ];
    if (new Set(secrets).size !== secrets.length)
      throw new Error(
        'Production authentication and gateway secrets must be distinct.',
      );
    const hosts =
      `${result.data.APP_BASE_DOMAINS},${result.data.APP_GENERIC_HOSTS}`.split(
        ',',
      );
    if (
      hosts.some(
        (host) => host.includes('localhost') || /^\d+(\.\d+){3}$/.test(host),
      )
    )
      throw new Error('Configure public application hostnames in production.');
    for (const origin of result.data.CORS_ORIGINS.split(',')) {
      const url = new URL(origin.trim());
      if (url.protocol !== 'https:' || url.origin !== origin.trim())
        throw new Error('Production CORS origins must be exact HTTPS origins.');
    }
    if (!result.data.DATABASE_URL)
      throw new Error('DATABASE_URL is required in production.');
  }
  return result.data;
}
