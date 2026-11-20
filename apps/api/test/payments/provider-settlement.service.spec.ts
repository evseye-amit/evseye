import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  ProviderSettlementService,
  type SettlementImport,
} from '../../src/payments/provider-settlement.service.js';

const report: SettlementImport = {
  providerSettlementId: 'CF-SET-1',
  currency: 'INR',
  grossAmount: '1000.00',
  refundAmount: '0.00',
  feeAmount: '17.00',
  taxAmount: '3.00',
  netAmount: '980.00',
  settledAt: '2026-09-27T00:00:00.000Z',
  items: [
    { kind: 'PAYMENT', providerReference: 'CF-PAY-1', amount: '1000.00' },
  ],
};

describe('provider settlement report import', () => {
  it.each([
    ['SETTLED', 'INR', 100000n, 'REPORT_MATCHED'],
    ['REVIEW_REQUIRED', 'INR', 100000n, 'REQUIRES_REVIEW'],
    ['SETTLED', 'USD', 100000n, 'REQUIRES_REVIEW'],
    ['SETTLED', 'INR', 99900n, 'REQUIRES_REVIEW'],
  ])('matches Razorpay deployment captures with identity, currency and amount checks (%s/%s/%s)', async (status, currency, amountPaise, expected) => {
    let stored: any;
    const tx = {
      providerSettlement: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }) => (stored = { id: 's', ...data })), findUniqueOrThrow: vi.fn(async () => stored) },
      paymentCollectionRequest: { findMany: vi.fn().mockResolvedValue([]) },
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      walletAutoRecharge: { findMany: vi.fn().mockResolvedValue([]) },
      deploymentPaymentCapture: { findMany: vi.fn().mockResolvedValue([{ id: 'capture', amountPaise, currency, status }]) },
      auditLog: { create: vi.fn() },
    };
    const service = new ProviderSettlementService({ $transaction: (fn: any) => fn(tx) } as never);
    const result = await service.importReport('client-a', 'admin', { ...report, provider: 'RAZORPAY' });
    expect(result.status).toBe(expected);
    expect(result.provider).toBe('RAZORPAY');
    expect(tx.deploymentPaymentCapture.findMany).toHaveBeenCalledWith({ where: { attempt: { clientId: 'client-a', provider: 'RAZORPAY' }, providerPaymentId: 'CF-PAY-1' } });
    expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith({ where: { clientId: 'client-a', provider: 'RAZORPAY', OR: [{ gatewayPaymentId: 'CF-PAY-1' }] } });
  });
  it('rejects an unsupported provider before persistence', async () => {
    const db = { $transaction: vi.fn() };
    await expect(new ProviderSettlementService(db as never).importReport('c', 'a', { ...report, provider: 'OTHER' } as never)).rejects.toThrow('UNSUPPORTED_SETTLEMENT_PROVIDER');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects a fee or net mismatch before touching persistence', async () => {
    const db = { $transaction: vi.fn() };
    const service = new ProviderSettlementService(db as never);
    await expect(
      service.importReport('client-a', 'admin-a', {
        ...report,
        netAmount: '981.00',
      }),
    ).rejects.toThrow('SETTLEMENT_TOTAL_MISMATCH');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('records a matched payment and returns the same import on retry', async () => {
    let stored: Record<string, unknown> | undefined;
    const tx = {
      providerSettlement: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(stored)),
        create: vi
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            stored = { id: 'settlement-1', ...data, items: [] };
            return Promise.resolve(stored);
          }),
        findUniqueOrThrow: vi
          .fn()
          .mockImplementation(() => Promise.resolve(stored)),
      },
      paymentCollectionRequest: {
        findMany: vi
          .fn()
          .mockResolvedValue([{
            currency: 'INR',
            id: 'collection-1',
            amount: new Prisma.Decimal('1000'),
            status: 'SUCCESS',
          }]),
      },
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: vi.fn(async (fn: (value: never) => Promise<unknown>) =>
        fn(tx as never),
      ),
    };
    const service = new ProviderSettlementService(db as never);
    const first = await service.importReport('client-a', 'admin-a', report);
    const second = await service.importReport('client-a', 'admin-a', report);
    expect(first.status).toBe('REPORT_MATCHED');
    expect(second).toEqual(first);
    expect(tx.providerSettlement.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it('keeps unknown provider payments in the review queue', async () => {
    const tx = {
      providerSettlement: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'settlement-2', ...data }),
          ),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ status: 'REQUIRES_REVIEW' }),
      },
      paymentCollectionRequest: { findMany: vi.fn().mockResolvedValue([]) },
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = {
      $transaction: vi.fn(async (fn: (value: never) => Promise<unknown>) =>
        fn(tx as never),
      ),
    };
    const service = new ProviderSettlementService(db as never);
    const result = await service.importReport('client-a', 'admin-a', report);
    expect(result.status).toBe('REQUIRES_REVIEW');
    expect(
      tx.providerSettlement.create.mock.calls[0][0].data.items.create[0]
        .reviewCode,
    ).toBe('MISSING_INTERNAL');
  });
});
