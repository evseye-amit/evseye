import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentsModule } from './payments.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { validateEnvironment } from '../config/environment.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.interface.js';

const settings: Record<string, string> = {
  PAYMENT_PROVIDER: 'cashfree',
  CASHFREE_ENVIRONMENT: 'SANDBOX',
  CASHFREE_CLIENT_ID: 'test-id',
  CASHFREE_CLIENT_SECRET: 'test-secret',
  CASHFREE_API_VERSION: '2026-01-01',
  CASHFREE_WEBHOOK_SECRET: 'test-webhook-secret',
  CASHFREE_SUBSCRIPTION_RETURN_URL: 'https://app.example/return',
};
afterEach(() => vi.unstubAllGlobals());

describe('Cashfree provider module and HTTP boundary', () => {
  it('resolves the selected adapter and performs create/fetch without real credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          subscription_id: 'sub-1',
          subscription_status: 'INITIALIZED',
          subscription_session_id: 'session-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          subscription_id: 'sub-1',
          subscription_status: 'ACTIVE',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue({
        getOrThrow: (key: string) =>
          (settings as Record<string, unknown>)[key] ??
          (validateEnvironment({}) as Record<string, unknown>)[key],
        get: (key: string) =>
          (settings as Record<string, unknown>)[key] ??
          (validateEnvironment({}) as Record<string, unknown>)[key],
      })
      .compile();
    const provider = module.get<PaymentProvider>(PAYMENT_PROVIDER);
    const created = await provider.createMandate({
      providerMandateId: 'sub-1',
      idempotencyKey: 'create-sub-1',
      customer: { name: 'Rider', phone: '9876543210' },
      planName: 'Weekly rental',
      mode: 'ON_DEMAND',
      maxAmount: '2500.00',
      expiresAt: '2027-01-01T00:00:00Z',
      paymentMethods: ['UPI_AUTOPAY'],
    });
    expect(created.sessionId).toBe('session-1');
    expect((await provider.fetchMandate('sub-1')).status).toBe('ACTIVE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await module.close();
  });
});
