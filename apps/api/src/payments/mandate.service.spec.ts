import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MandateService } from './mandate.service.js';

const clientId = 'client-1';
const userId = 'user-1';
const rider = { id: 'rider-1', name: 'A Rider', mobile: '9876543210' };
const packageFeature = {
  configuration: {
    mandateMaxAmount: '2500.00',
    validityDays: 365,
    paymentMethods: ['UPI_AUTOPAY'],
  },
};
const subscription = {
  package: {
    code: 'BASIC',
    name: 'Basic',
    isActive: true,
    features: [packageFeature],
  },
};
const mandate = {
  id: 'mandate-1',
  clientId,
  riderId: rider.id,
  providerMandateId: 'EVSEYE_test',
  requestKey: 'create-key-1',
  status: 'CREATED',
  providerStatus: 'INITIALIZED',
  authorizationSessionId: 'session-1',
  maxAmount: new Prisma.Decimal('2500'),
  currency: 'INR',
  expiresAt: new Date('2027-09-25'),
  authorizedAt: null,
};

function fixture(providerType = 'mock') {
  const storedMandate = { ...mandate };
  const prisma = {
    rider: { findFirst: vi.fn().mockResolvedValue(rider) },
    clientSubscription: { findFirst: vi.fn().mockResolvedValue(subscription) },
    paymentMandate: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(
          ({ data }: { data: { providerMandateId: string } }) => {
            storedMandate.providerMandateId = data.providerMandateId;
            return Promise.resolve(storedMandate);
          },
        ),
      update: vi.fn().mockResolvedValue(mandate),
    },
    riderPaymentProfile: { upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        paymentMandate: {
          findUniqueOrThrow: vi
            .fn()
            .mockImplementation(() => Promise.resolve(storedMandate)),
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi
            .fn()
            .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
              Promise.resolve({ ...storedMandate, ...data }),
            ),
        },
        riderPaymentProfile: prisma.riderPaymentProfile,
      }),
    ),
    paymentProviderEvent: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  };
  const provider = {
    createMandate: vi
      .fn()
      .mockImplementation(
        ({ providerMandateId }: { providerMandateId: string }) =>
          Promise.resolve({
            providerMandateId,
            status: 'CREATED',
            rawStatus: 'INITIALIZED',
            sessionId: 'session-1',
          }),
      ),
    fetchMandate: vi.fn().mockResolvedValue({
      providerMandateId: mandate.providerMandateId,
      status: 'ACTIVE',
      rawStatus: 'ACTIVE',
    }),
    verifyWebhook: vi.fn(),
  };
  const config = {
    getOrThrow: (key: string) =>
      key === 'PAYMENT_PROVIDER' ? providerType : 'SANDBOX',
  };
  const collections = {
    processWebhook: vi.fn().mockResolvedValue('payment-1'),
  };
  return {
    prisma,
    provider,
    collections,
    service: new MandateService(
      prisma as never,
      config as never,
      provider as never,
      collections as never,
    ),
  };
}

describe('UPI AutoPay mandate service', () => {
  it('requires an active package with configured entitlement', async () => {
    const { service, prisma } = fixture();
    prisma.clientSubscription.findFirst.mockResolvedValue(null);
    await expect(service.current(clientId, userId)).rejects.toThrow(
      'active client package',
    );
    prisma.clientSubscription.findFirst.mockResolvedValue({
      package: { ...subscription.package, features: [] },
    });
    await expect(service.current(clientId, userId)).rejects.toThrow(
      'not included',
    );
    expect(prisma.clientSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId, status: 'ACTIVE' }),
      }),
    );
  });

  it('returns the same mandate on a repeated create key without another provider POST', async () => {
    const { service, prisma, provider } = fixture('cashfree');
    prisma.paymentMandate.findUnique.mockResolvedValue(mandate);
    expect(
      (await service.create(clientId, userId, mandate.requestKey))
        .subscriptionSessionId,
    ).toBe('session-1');
    expect(provider.createMandate).not.toHaveBeenCalled();
  });

  it('creates a UPI mandate from the package configuration with snapshotted terms', async () => {
    const { service, prisma, provider } = fixture();
    const result = await service.create(clientId, userId, 'first-key-1');
    expect(result.subscriptionSessionId).toBe('session-1');
    expect(prisma.paymentMandate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId,
          riderId: rider.id,
          requestKey: 'first-key-1',
          maxAmount: new Prisma.Decimal('2500.00'),
        }),
      }),
    );
    expect(provider.createMandate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAmount: '2500.00',
        paymentMethods: ['UPI_AUTOPAY'],
        mode: 'ON_DEMAND',
      }),
    );
    expect(prisma.riderPaymentProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { autoPayEnabled: false } }),
    );
  });

  it('rejects a second authorization attempt while an open mandate exists', async () => {
    const { service, prisma, provider } = fixture();
    prisma.paymentMandate.findFirst.mockResolvedValue(mandate);
    await expect(
      service.create(clientId, userId, 'another-key-1'),
    ).rejects.toThrow('already exists');
    expect(provider.createMandate).not.toHaveBeenCalled();
  });

  it('activates only after a provider fetch and scopes verification to the rider', async () => {
    const { service, prisma, provider } = fixture();
    prisma.paymentMandate.findFirst.mockResolvedValue(mandate);
    const response = await service.verify(clientId, userId, mandate.id);
    expect(response.status).toBe('ACTIVE');
    expect(provider.fetchMandate).toHaveBeenCalledWith(
      mandate.providerMandateId,
    );
    expect(prisma.paymentMandate.findFirst).toHaveBeenCalledWith({
      where: { id: mandate.id, clientId, riderId: rider.id },
    });
    expect(prisma.riderPaymentProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { autoPayEnabled: true } }),
    );
  });

  it('does not activate AutoPay for an unknown provider status', async () => {
    const { service, prisma, provider } = fixture();
    prisma.paymentMandate.findFirst.mockResolvedValue(mandate);
    provider.fetchMandate.mockResolvedValue({
      providerMandateId: mandate.providerMandateId,
      status: 'UNKNOWN',
      rawStatus: 'UNRECOGNIZED',
    });
    const response = await service.verify(clientId, userId, mandate.id);
    expect(response.status).toBe('UNKNOWN');
    expect(prisma.riderPaymentProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { autoPayEnabled: false } }),
    );
  });

  it('deduplicates an already processed signed webhook', async () => {
    const { service, prisma, provider } = fixture('cashfree');
    const raw = Buffer.from('{"type":"SUBSCRIPTION_STATUS_CHANGED"}');
    provider.verifyWebhook.mockReturnValue({
      payload: { type: 'SUBSCRIPTION_STATUS_CHANGED' },
    });
    prisma.paymentProviderEvent.findUnique.mockResolvedValue({
      status: 'PROCESSED',
    });
    await expect(
      service.webhook(raw, 'timestamp', 'signature'),
    ).resolves.toEqual({ accepted: true, duplicate: true });
    expect(prisma.paymentProviderEvent.findUnique).toHaveBeenCalledWith({
      where: {
        provider_eventKey: {
          provider: 'CASHFREE',
          eventKey: createHash('sha256').update(raw).digest('hex'),
        },
      },
    });
    expect(provider.fetchMandate).not.toHaveBeenCalled();
  });

  it('rejects an invalid webhook before any database read', async () => {
    const { service, prisma, provider } = fixture('cashfree');
    provider.verifyWebhook.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(
      service.webhook(Buffer.from('{}'), 'timestamp', 'bad'),
    ).rejects.toThrow('invalid signature');
    expect(prisma.paymentProviderEvent.findUnique).not.toHaveBeenCalled();
  });

  it('reconciles a valid subscription event against Cashfree before recording it processed', async () => {
    const { service, prisma, provider } = fixture('cashfree');
    const raw = Buffer.from(
      JSON.stringify({
        type: 'SUBSCRIPTION_STATUS_CHANGED',
        data: {
          subscription_details: { subscription_id: mandate.providerMandateId },
        },
      }),
    );
    provider.verifyWebhook.mockReturnValue({
      payload: JSON.parse(raw.toString()),
    });
    prisma.paymentMandate.findUnique.mockResolvedValue(mandate);
    prisma.paymentProviderEvent.upsert.mockResolvedValue({ id: 'event-1' });
    await expect(
      service.webhook(raw, 'timestamp', 'signature'),
    ).resolves.toEqual({ accepted: true });
    expect(provider.fetchMandate).toHaveBeenCalledWith(
      mandate.providerMandateId,
    );
    expect(prisma.riderPaymentProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { autoPayEnabled: true } }),
    );
    expect(prisma.paymentProviderEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({ status: 'PROCESSED' }),
    });
  });

  it('reconciles a signed payment webhook and links its transaction to the provider event', async () => {
    const { service, prisma, provider, collections } = fixture('cashfree');
    const payload = {
      type: 'SUBSCRIPTION_PAYMENT_SUCCESS',
      data: {
        subscription_id: mandate.providerMandateId,
        payment_id: 'EVSEYE_PAY_1',
        payment_type: 'CHARGE',
      },
    };
    provider.verifyWebhook.mockReturnValue({ payload });
    prisma.paymentMandate.findUnique.mockResolvedValue(mandate);
    prisma.paymentProviderEvent.upsert.mockResolvedValue({
      id: 'event-payment-1',
    });
    await expect(
      service.webhook(
        Buffer.from(JSON.stringify(payload)),
        'timestamp',
        'signature',
      ),
    ).resolves.toEqual({ accepted: true });
    expect(collections.processWebhook).toHaveBeenCalledWith(
      clientId,
      mandate.providerMandateId,
      'EVSEYE_PAY_1',
    );
    expect(prisma.paymentProviderEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-payment-1' },
      data: expect.objectContaining({
        status: 'PROCESSED',
        paymentTransactionId: 'payment-1',
      }),
    });
  });
});
