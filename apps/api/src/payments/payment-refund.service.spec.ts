import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  PaymentRefundService,
  refundableAmount,
} from './payment-refund.service.js';

const refund = {
  id: 'refund-1',
  clientId: 'client-1',
  riderId: 'rider-1',
  paymentId: 'payment-1',
  amount: new Prisma.Decimal('1200.00'),
  currency: 'INR',
  reason: 'Duplicate charge',
  providerRefundId: 'EVSEYE_REF_1',
  status: 'PENDING',
  requestedById: 'admin-1',
  requestedAt: new Date(),
  completedAt: null,
};
function fixture(providerResult: {
  providerRefundId: string;
  status: string;
  rawStatus: string;
  amount?: string;
  currency?: string;
}) {
  const tx = {
    paymentRefund: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(refund),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...refund, ...data }),
        ),
    },
  };
  const prisma = {
    paymentRefund: {
      findFirst: vi.fn().mockResolvedValue(refund),
      update: vi.fn(),
    },
    paymentCollectionRequest: {
      findFirst: vi.fn().mockResolvedValue({ providerOrderId: 'ORDER-1' }),
    },
    paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const provider = {
    fetchCheckoutRefund: vi.fn().mockResolvedValue(providerResult),
  };
  const payments = {
    confirmProviderRefundInTransaction: vi.fn().mockResolvedValue({}),
  };
  const service = new PaymentRefundService(
    prisma as never,
    provider as never,
    payments as never,
  );
  return { service, prisma, provider, payments };
}
describe('verified provider refunds', () => {
  it('reserves concurrent partial refunds and permits only the remaining payment value', () => {
    const d = (value: string) => new Prisma.Decimal(value);
    expect(
      refundableAmount(d('1000'), d('300'), d('300'), d('800')).toFixed(2),
    ).toBe('200.00');
    expect(
      refundableAmount(d('1000'), d('600'), d('0'), d('0')).toFixed(2),
    ).toBe('400.00');
    expect(
      refundableAmount(d('1000'), d('300'), d('300'), d('1000')).toFixed(2),
    ).toBe('0.00');
  });
  it('keeps the receipt and invoices unchanged when the provider amount differs', async () => {
    const { service, prisma, payments } = fixture({
      providerRefundId: refund.providerRefundId,
      status: 'SUCCESS',
      rawStatus: 'SUCCESS',
      amount: '1199.00',
      currency: 'INR',
    });
    await expect(
      service.verify(refund.clientId, refund.riderId, refund.id),
    ).rejects.toThrow('PROVIDER_REFUND_AMOUNT_MISMATCH');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(payments.confirmProviderRefundInTransaction).not.toHaveBeenCalled();
  });
  it('reverses the receipt inside the refund settlement transaction', async () => {
    const { service, payments, prisma } = fixture({
      providerRefundId: refund.providerRefundId,
      status: 'SUCCESS',
      rawStatus: 'SUCCESS',
      amount: '1200.00',
      currency: 'INR',
    });
    const result = await service.verify(
      refund.clientId,
      refund.riderId,
      refund.id,
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(payments.confirmProviderRefundInTransaction).toHaveBeenCalledOnce();
    expect(result.status).toBe('SUCCESS');
  });
});

describe('refund webhook dispatch', () => {
  const body = Buffer.from(
    JSON.stringify({
      type: 'REFUND_STATUS_WEBHOOK',
      data: { refund: { refund_id: refund.providerRefundId } },
    }),
  );
  it('rejects an unsigned callback before querying any refund', async () => {
    const prisma = { paymentRefund: { findUnique: vi.fn() } };
    const provider = {
      verifyCheckoutWebhook: vi.fn().mockImplementation(() => {
        throw new Error('Invalid signature');
      }),
    };
    const service = new PaymentRefundService(
      prisma as never,
      provider as never,
      {} as never,
    );
    await expect(service.webhook(body, 'timestamp', 'bad')).rejects.toThrow(
      'Invalid signature',
    );
    expect(prisma.paymentRefund.findUnique).not.toHaveBeenCalled();
  });
  it('does not finalize a duplicate processed callback', async () => {
    const prisma = {
      paymentRefund: { findUnique: vi.fn().mockResolvedValue(refund) },
      paymentCollectionRequest: {
        findFirst: vi.fn().mockResolvedValue({ providerOrderId: 'ORDER-1' }),
      },
      paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
      paymentProviderEvent: {
        upsert: vi
          .fn()
          .mockResolvedValue({ id: 'event-1', status: 'PROCESSED' }),
      },
    };
    const provider = {
      verifyCheckoutWebhook: vi
        .fn()
        .mockReturnValue({ payload: JSON.parse(body.toString()) }),
    };
    const service = new PaymentRefundService(
      prisma as never,
      provider as never,
      {} as never,
    );
    const verify = vi.spyOn(service, 'verify');
    expect(await service.webhook(body, 'timestamp', 'signature')).toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(verify).not.toHaveBeenCalled();
  });
});
