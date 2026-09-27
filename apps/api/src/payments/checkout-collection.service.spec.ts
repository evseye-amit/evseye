import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutCollectionService } from './checkout-collection.service.js';

const request = {
  id: 'collection-1',
  clientId: 'client-1',
  riderId: 'rider-1',
  invoiceId: 'invoice-1',
  depositId: null,
  status: 'PENDING',
  amount: new Prisma.Decimal('900.00'),
  currency: 'INR',
  method: 'UPI',
  provider: 'CASHFREE',
  providerOrderId: 'EVSEYE_PG_1',
  providerPaymentId: null,
  paymentSessionId: 'session-1',
  riderPaymentId: null,
  failureCode: null,
};
const success = {
  orderId: request.providerOrderId,
  providerPaymentId: 'cf-123',
  status: 'SUCCESS',
  rawStatus: 'SUCCESS',
  amount: '900.00',
  currency: 'INR',
};
function fixture(result = success, depositInvoice = false) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    riderInvoice: { findFirst: vi.fn().mockResolvedValue(depositInvoice ? { id: request.invoiceId, outstandingAmount: request.amount, lines: [{ sourceId: 'deposit-1', chargeType: 'SECURITY_DEPOSIT' }] } : null), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: request.invoiceId, paidAmount: new Prisma.Decimal(0), outstandingAmount: request.amount }), update: vi.fn().mockResolvedValue({}) },
    walletAccount: { findMany: vi.fn().mockResolvedValue([{ id: 'clearing', accountType: 'CLEARING' }, { id: 'provider', accountType: 'PROVIDER_CLEARING' }, { id: 'deposit-account', accountType: 'SECURITY_DEPOSIT' }]) },
    walletSecurityDeposit: { findFirst: vi.fn().mockResolvedValue({ id: 'deposit-1', requiredAmount: request.amount }), update: vi.fn().mockResolvedValue({}) },
    walletInvoiceAllocation: { create: vi.fn().mockResolvedValue({}) },
    paymentAttempt: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue({ sequence: 1 }), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    riderPayment: { findUniqueOrThrow: vi.fn().mockResolvedValue({ unallocatedAmount: new Prisma.Decimal(0) }) },
    paymentCollectionRequest: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(request),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...request, ...data }),
        ),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    riderInvoice: { findFirst: vi.fn().mockResolvedValue(null) },
    paymentCollectionRequest: {
      findFirst: vi.fn().mockResolvedValue(request),
      findUnique: vi.fn().mockResolvedValue(request),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(request),
    },
    paymentProviderEvent: {
      upsert: vi.fn().mockResolvedValue({ id: 'event-1', status: 'PROCESSED' }),
      update: vi.fn(),
    },
    providerPaymentObservation: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const provider = {
    fetchCheckoutPayments: vi.fn().mockResolvedValue([result]),
    fetchCheckoutOrder: vi.fn().mockResolvedValue({ orderId: request.providerOrderId, status: 'ACTIVE' }),
    verifyCheckoutWebhook: vi
      .fn()
      .mockReturnValue({
        payload: {
          type: 'PAYMENT_SUCCESS_WEBHOOK',
          data: { order: { order_id: request.providerOrderId } },
        },
      }),
  };
  const payments = {
    confirmProviderPaymentInTransaction: vi
      .fn()
      .mockResolvedValue({ id: 'receipt-1' }),
  };
  const wallet = { ensure: vi.fn().mockResolvedValue({ id: 'wallet-1' }), postInTransaction: vi.fn().mockResolvedValue({ id: 'ledger-1' }) };
  const walletBilling = { settle: vi.fn() };
  const walletDeposits = { summaryTx: vi.fn().mockResolvedValue({ outstandingAmount: '900.00' }) };
  const service = new CheckoutCollectionService(
    prisma as never,
    { getOrThrow: vi.fn().mockReturnValue('mock') } as never,
    provider as never,
    payments as never,
    {} as never,
    walletBilling as never,
    wallet as never,
    walletDeposits as never,
  );
  return { service, prisma, provider, payments, tx, wallet, walletBilling };
}

describe('checkout collection settlement', () => {
  it('skips provider order creation when eligible wallet funds pay the invoice', async () => {
    const { service, prisma, walletBilling } = fixture();
    prisma.paymentCollectionRequest.findUnique.mockResolvedValue(null);
    prisma.riderInvoice.findFirst.mockResolvedValue({ paidAmount: new Prisma.Decimal(0) });
    walletBilling.settle.mockResolvedValue({ paidAmount: request.amount, outstandingAmount: new Prisma.Decimal(0), currency: 'INR' });
    const result = await service.payInvoice(request.clientId, request.riderId, request.invoiceId, 'checkout-key-2', true, 'user-1');
    expect(result.status).toBe('PAID');
    expect(result.paymentSessionId).toBeNull();
    expect(walletBilling.settle).toHaveBeenCalledWith(request.clientId, request.invoiceId, 'user-1', 'checkout:checkout-key-2');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('checks invoice ownership before spending wallet funds', async () => {
    const { service, walletBilling, prisma } = fixture();
    prisma.paymentCollectionRequest.findUnique.mockResolvedValue(null);
    await expect(service.payInvoice(request.clientId, request.riderId, 'another-rider-invoice', 'checkout-key-1', true, 'user-1'))
      .rejects.toThrow('INVOICE_NOT_FOUND');
    expect(walletBilling.settle).not.toHaveBeenCalled();
  });
  it('rejects a provider amount mismatch without creating a financial receipt', async () => {
    const { service, prisma, payments } = fixture({
      ...success,
      amount: '899.00',
    });
    await expect(
      service.verify(request.clientId, request.riderId, request.id),
    ).rejects.toThrow('PROVIDER_PAYMENT_MISMATCH');
    expect(prisma.providerPaymentObservation.upsert).toHaveBeenCalledOnce();
    expect(payments.confirmProviderPaymentInTransaction).not.toHaveBeenCalled();
  });

  it('settles only after server-side verification and links one receipt', async () => {
    const { service, provider, payments, tx } = fixture();
    const result = await service.verify(
      request.clientId,
      request.riderId,
      request.id,
    );
    expect(provider.fetchCheckoutPayments).toHaveBeenCalledWith(
      request.providerOrderId,
    );
    expect(payments.confirmProviderPaymentInTransaction).toHaveBeenCalledOnce();
    expect(tx.paymentCollectionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SUCCESS',
          riderPaymentId: 'receipt-1',
        }),
      }),
    );
    expect(result.status).toBe('SUCCESS');
  });

  it('requires review when the provider returns multiple successful payments', async () => {
    const { service, provider, payments } = fixture();
    provider.fetchCheckoutPayments.mockResolvedValue([
      success,
      { ...success, providerPaymentId: 'cf-456' },
    ]);
    await expect(
      service.verify(request.clientId, request.riderId, request.id),
    ).rejects.toThrow('MULTIPLE_PROVIDER_SUCCESSES_REQUIRE_REVIEW');
    expect(payments.confirmProviderPaymentInTransaction).not.toHaveBeenCalled();
  });
  it('marks checkout expired only after the provider reports expiration', async () => {
    const { service, provider, prisma, payments } = fixture();
    provider.fetchCheckoutPayments.mockResolvedValue([]);
    provider.fetchCheckoutOrder.mockResolvedValue({ orderId: request.providerOrderId, status: 'EXPIRED' });
    await service.verify(request.clientId, request.riderId, request.id);
    expect(prisma.paymentCollectionRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) }));
    expect(payments.confirmProviderPaymentInTransaction).not.toHaveBeenCalled();
  });
  it('funds a Phase 3 deposit invoice from verified external money', async () => {
    const { service, tx, wallet, payments } = fixture(success, true);
    const result = await service.verify(request.clientId, request.riderId, request.id);
    expect(result.status).toBe('SUCCESS');
    expect(payments.confirmProviderPaymentInTransaction).not.toHaveBeenCalled();
    expect(wallet.postInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
      type: 'SECURITY_DEPOSIT', referenceType: 'WALLET_SECURITY_DEPOSIT',
      entries: expect.arrayContaining([{ accountId: 'deposit-account', entryType: 'CREDIT', amount: '900.00' }]),
    }));
    expect(tx.walletInvoiceAllocation.create).toHaveBeenCalledOnce();
    expect(tx.riderInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }));
  });
  it('ignores an already processed duplicate webhook without another financial effect', async () => {
    const { service, provider, payments, prisma } = fixture();
    expect(
      await service.webhook(Buffer.from('{}'), 'timestamp', 'signature'),
    ).toEqual({ accepted: true, duplicate: true });
    expect(provider.verifyCheckoutWebhook).toHaveBeenCalledOnce();
    expect(prisma.paymentProviderEvent.upsert).toHaveBeenCalledOnce();
    expect(payments.confirmProviderPaymentInTransaction).not.toHaveBeenCalled();
  });
  it('rejects an invalid webhook signature before persisting an event', async () => {
    const { service, provider, prisma } = fixture();
    provider.verifyCheckoutWebhook.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    await expect(
      service.webhook(Buffer.from('{}'), 'timestamp', 'bad'),
    ).rejects.toThrow('Invalid signature');
    expect(prisma.paymentProviderEvent.upsert).not.toHaveBeenCalled();
  });
});
