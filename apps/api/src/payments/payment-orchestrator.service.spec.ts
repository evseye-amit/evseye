import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';

const clientId = 'client-1';
const riderId = 'rider-1';
const invoiceId = 'invoice-1';
const scheduledAt = '2027-01-01T12:00:00.000Z';
const amount = new Prisma.Decimal('1200.00');

function fixture() {
  const invoice = {
    id: invoiceId,
    clientId,
    riderId,
    invoiceNumber: 'INV-1',
    status: 'FINALIZED',
    outstandingAmount: amount,
    paidAmount: new Prisma.Decimal(0),
    currency: 'INR',
  };
  const mandate = {
    id: 'mandate-1',
    clientId,
    riderId,
    status: 'ACTIVE',
    providerMandateId: 'CF-MANDATE-1',
    maxAmount: new Prisma.Decimal('2500.00'),
    currency: 'INR',
  };
  let payment = {
    id: 'payment-1',
    clientId,
    riderId,
    invoiceId,
    mandateId: mandate.id,
    requestKey: 'collect-key-1',
    providerPaymentId: 'EVSEYE_PAY_1',
    status: 'PENDING',
    amount,
    currency: 'INR',
    scheduledAt: new Date(scheduledAt),
    providerReference: null as string | null,
    completedAt: null as Date | null,
    lastVerifiedAt: null as Date | null,
  };
  const tx = {
    riderInvoice: {
      findFirst: vi.fn().mockResolvedValue(invoice),
      findUniqueOrThrow: vi.fn().mockResolvedValue(invoice),
      update: vi.fn().mockResolvedValue(invoice),
    },
    paymentMandate: {
      findFirst: vi.fn().mockResolvedValue(mandate),
      findUniqueOrThrow: vi.fn().mockResolvedValue(mandate),
    },
    paymentTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi
        .fn()
        .mockImplementation(() => Promise.resolve(payment)),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          payment = {
            ...payment,
            ...data,
            status: 'CREATING',
          } as typeof payment;
          return Promise.resolve(payment);
        }),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          payment = { ...payment, ...data } as typeof payment;
          return Promise.resolve(payment);
        }),
    },
    paymentAttempt: { update: vi.fn().mockResolvedValue({}) },
    riderLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
    paymentMandate: { findFirstOrThrow: vi.fn().mockResolvedValue(mandate) },
    paymentTransaction: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(payment)),
      update: vi.fn(),
    },
  };
  const provider = {
    createPayment: vi
      .fn()
      .mockImplementation(
        ({
          providerMandateId,
          providerPaymentId,
        }: {
          providerMandateId: string;
          providerPaymentId: string;
        }) =>
          Promise.resolve({
            providerMandateId,
            providerPaymentId,
            status: 'PENDING',
            rawStatus: 'SCHEDULED',
          }),
      ),
    fetchPayment: vi.fn().mockResolvedValue({
      providerMandateId: mandate.providerMandateId,
      providerPaymentId: payment.providerPaymentId,
      status: 'SUCCESS',
      rawStatus: 'SUCCESS',
      amount: '1200.00',
      paymentType: 'CHARGE',
      providerReference: 'cf-payment-1',
    }),
  };
  const config = { getOrThrow: vi.fn(() => 'cashfree') };
  return {
    invoice,
    mandate,
    payment: () => payment,
    tx,
    prisma,
    provider,
    service: new PaymentOrchestratorService(
      prisma as never,
      config as never,
      provider as never,
    ),
  };
}

describe('invoice AutoPay collection', () => {
  it('charges only the server-side finalized invoice balance and creates one attempt', async () => {
    const f = fixture();
    const response = await f.service.collect(
      clientId,
      riderId,
      invoiceId,
      'collect-key-1',
      scheduledAt,
    );
    expect(response.status).toBe('PENDING');
    expect(f.provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '1200.00',
        providerMandateId: f.mandate.providerMandateId,
      }),
    );
    expect(f.tx.paymentTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount,
          attempts: { create: expect.objectContaining({ sequence: 1 }) },
        }),
      }),
    );
    expect(f.tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('rejects an invoice amount above the mandate limit before calling Cashfree', async () => {
    const f = fixture();
    f.mandate.maxAmount = new Prisma.Decimal('1000.00');
    await expect(
      f.service.collect(
        clientId,
        riderId,
        invoiceId,
        'collect-key-1',
        scheduledAt,
      ),
    ).rejects.toThrow('exceeds');
    expect(f.provider.createPayment).not.toHaveBeenCalled();
  });

  it('returns an existing invoice collection without posting another charge', async () => {
    const f = fixture();
    f.tx.paymentTransaction.findUnique.mockResolvedValue(f.payment());
    const response = await f.service.collect(
      clientId,
      riderId,
      invoiceId,
      'collect-key-1',
      '2020-01-01T00:00:00.000Z',
    );
    expect(response.status).toBe('PENDING');
    expect(f.provider.createPayment).not.toHaveBeenCalled();
  });

  it('settles a verified successful charge exactly once', async () => {
    const f = fixture();
    const first = await f.service.verify(clientId, riderId, f.payment().id);
    expect(first.status).toBe('SUCCESS');
    expect(f.tx.riderLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(f.tx.riderLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'PAYMENT_TRANSACTION',
          creditAmount: amount,
        }),
      }),
    );
    expect(f.tx.riderInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAID',
          outstandingAmount: new Prisma.Decimal(0),
        }),
      }),
    );
    await f.service.verify(clientId, riderId, f.payment().id);
    expect(f.tx.riderLedgerEntry.create).toHaveBeenCalledTimes(1);
  });

  it('does not settle when the provider amount differs from the invoice snapshot', async () => {
    const f = fixture();
    f.provider.fetchPayment.mockResolvedValue({
      providerMandateId: f.mandate.providerMandateId,
      providerPaymentId: f.payment().providerPaymentId,
      status: 'SUCCESS',
      rawStatus: 'SUCCESS',
      amount: '1199.00',
      paymentType: 'CHARGE',
      providerReference: 'cf-payment-1',
    });
    await expect(
      f.service.verify(clientId, riderId, f.payment().id),
    ).rejects.toThrow('does not match');
    expect(f.tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('records a failed provider payment without touching the invoice ledger', async () => {
    const f = fixture();
    f.provider.fetchPayment.mockResolvedValue({
      providerMandateId: f.mandate.providerMandateId,
      providerPaymentId: f.payment().providerPaymentId,
      status: 'FAILED',
      rawStatus: 'FAILED',
      amount: '1200.00',
      paymentType: 'CHARGE',
    });
    expect(
      (await f.service.verify(clientId, riderId, f.payment().id)).status,
    ).toBe('FAILED');
    expect(f.tx.riderLedgerEntry.create).not.toHaveBeenCalled();
    expect(f.tx.riderInvoice.update).not.toHaveBeenCalled();
  });

  it('keeps an uncertain charge reserved and does not repeat the provider POST', async () => {
    const f = fixture();
    f.provider.createPayment.mockRejectedValue(new Error('timeout'));
    f.prisma.paymentTransaction.update.mockResolvedValue({});
    await expect(
      f.service.collect(
        clientId,
        riderId,
        invoiceId,
        'collect-key-1',
        scheduledAt,
      ),
    ).rejects.toThrow('uncertain');
    expect(f.prisma.paymentTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'UNKNOWN' }),
      }),
    );
    expect(f.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(f.tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });
});
