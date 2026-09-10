import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-123'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-123'),
  OTP_HASH_SECRET: z.string().min(32).default('development-otp-hash-secret-change-me-123'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SMS_PROVIDER: z.string().default('console'),
  KYC_PROVIDER: z.string().default('sandbox'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }

  if (
    result.data.NODE_ENV === 'production' &&
    (result.data.JWT_ACCESS_SECRET.includes('change-me') ||
      result.data.JWT_REFRESH_SECRET.includes('change-me') ||
      result.data.OTP_HASH_SECRET.includes('change-me'))
  ) {
    throw new Error('JWT secrets must be replaced before running in production.');
  }

  return result.data;
}
