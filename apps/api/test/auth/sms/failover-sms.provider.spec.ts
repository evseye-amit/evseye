import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FailoverSmsProvider } from '../../../src/auth/sms/failover-sms.provider.js';
import type { SendSmsInput } from '../../../src/auth/sms/sms-provider.interface.js';

type Policy = { primaryProvider: string; fallbackProvider: string | null; maxAttempts: number };
type Sender = (input: SendSmsInput) => Promise<void>;

function setup(policy: Policy, options: { production?: boolean; primary?: Sender; fallback?: Sender } = {}) {
  const primary: Sender = options.primary ?? vi.fn<Sender>().mockResolvedValue(undefined);
  const fallback: Sender = options.fallback ?? vi.fn<Sender>().mockResolvedValue(undefined);
  const rows: Array<Record<string, unknown>> = [];
  const prisma = {
    smsProviderPolicy: { findUnique: vi.fn().mockResolvedValue(policy) },
    smsDelivery: {
      create: vi.fn().mockImplementation(({ data }) => {
        const row = { id: `delivery-${rows.length + 1}`, ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        Object.assign(rows.find((row) => row.id === where.id)!, data);
        return Promise.resolve(rows.find((row) => row.id === where.id));
      }),
    },
  };
  const service = new FailoverSmsProvider(
    { send: primary },
    { send: fallback },
    prisma as never,
    { console: { send: primary }, telipia: { send: fallback } },
    options.production ?? false,
  );
  return { service, primary, fallback, prisma, rows };
}

const input = { phone: '+919999999999', code: '123456', purpose: 'LOGIN', otpRequestId: 'otp-1' };

describe('FailoverSmsProvider', () => {
  it('records the configured primary attempt and stops on success', async () => {
    const { service, primary, fallback, rows } = setup({ primaryProvider: 'console', fallbackProvider: 'telipia', maxAttempts: 3 });

    await service.send(input);

    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(rows).toEqual([expect.objectContaining({ provider: 'console', attempt: 1, status: 'DELIVERED' })]);
  });

  it('uses the fallback after a primary failure and records actual attempts', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('primary secret payload'));
    const fallback = vi.fn().mockResolvedValue(undefined);
    const { service, rows } = setup({ primaryProvider: 'console', fallbackProvider: 'telipia', maxAttempts: 2 }, { primary, fallback });

    await service.send(input);

    expect(rows).toEqual([
      expect.objectContaining({ provider: 'console', attempt: 1, status: 'FAILED', errorCode: 'PROVIDER_ERROR' }),
      expect.objectContaining({ provider: 'telipia', attempt: 2, status: 'DELIVERED' }),
    ]);
  });

  it('retries the primary when no fallback is configured and honors maxAttempts', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('gateway failed'));
    const { service, fallback, rows } = setup({ primaryProvider: 'console', fallbackProvider: null, maxAttempts: 3 }, { primary });

    await expect(service.send(input)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(primary).toHaveBeenCalledTimes(3);
    expect(fallback).not.toHaveBeenCalled();
    expect(rows.map((row) => [row.provider, row.attempt, row.status])).toEqual([
      ['console', 1, 'FAILED'], ['console', 2, 'FAILED'], ['console', 3, 'FAILED'],
    ]);
  });

  it('never calls fallback when maxAttempts is one', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('primary failed'));
    const { service, fallback, rows } = setup({ primaryProvider: 'console', fallbackProvider: 'telipia', maxAttempts: 1 }, { primary });

    await expect(service.send(input)).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it('fails closed when policy lookup fails or a stored production policy selects console', async () => {
    const setupWithLookupFailure = setup({ primaryProvider: 'telipia', fallbackProvider: null, maxAttempts: 1 });
    setupWithLookupFailure.prisma.smsProviderPolicy.findUnique.mockRejectedValue(new Error('database unavailable'));
    await expect(setupWithLookupFailure.service.send(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(setupWithLookupFailure.primary).not.toHaveBeenCalled();

    const stale = setup({ primaryProvider: 'console', fallbackProvider: null, maxAttempts: 1 }, { production: true });
    await expect(stale.service.send(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(stale.primary).not.toHaveBeenCalled();
  });

  it('does not leak provider error payloads', async () => {
    const primary = vi.fn().mockRejectedValue(new Error('secret-key https://sms.example.com?otp=123456'));
    const { service } = setup({ primaryProvider: 'console', fallbackProvider: null, maxAttempts: 1 }, { primary });

    await expect(service.send(input)).rejects.toThrow('SMS delivery is temporarily unavailable');
    await expect(service.send(input)).rejects.not.toThrow('secret-key');
  });
});
