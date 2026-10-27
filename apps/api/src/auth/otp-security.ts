import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Environment } from '../config/environment.js';

/** Shared cryptographic and timing rules for all OTP workflows. */
export class OtpSecurity {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  generateCode(): string {
    return this.config.getOrThrow('NODE_ENV') === 'development' &&
      this.config.getOrThrow('SMS_PROVIDER') === 'console'
      ? '123456'
      : randomInt(100_000, 1_000_000).toString();
  }

  hash(value: string): string {
    return createHmac('sha256', this.config.getOrThrow('OTP_HASH_SECRET'))
      .update(value)
      .digest('hex');
  }

  verify(value: string, hash: string): boolean {
    const expected = Buffer.from(hash, 'hex');
    const actual = Buffer.from(this.hash(value), 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  expiresAt(): Date {
    return new Date(
      Date.now() + this.config.getOrThrow<number>('OTP_TTL_SECONDS') * 1000,
    );
  }
}
