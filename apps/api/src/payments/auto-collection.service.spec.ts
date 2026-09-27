import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  AutoCollectionService,
  collectionDate,
} from './auto-collection.service.js';

const invoice = {
  id: 'invoice-1',
  clientId: 'client-1',
  riderId: 'rider-1',
  issuedAt: new Date('2026-09-20T00:00:00Z'),
  dueDate: new Date('2026-09-29T00:00:00Z'),
  outstandingAmount: new Prisma.Decimal('1650.00'),
  lines: [{ kind: 'CHARGE', chargeType: 'RENTAL' }],
};
function fixture(
  transactions: Array<{
    status: string;
    retryability: string | null;
    updatedAt: Date;
  }> = [],
  walletFirst = false,
) {
  const prisma = {
    riderInvoice: {
      findMany: vi.fn().mockResolvedValueOnce([invoice]).mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(invoice),
    },
    paymentCollectionPolicy: {
      findUnique: vi.fn().mockResolvedValue({
        enabled: true,
        collectionTiming: 'ON_DUE_DATE',
        beforeDueDays: 0,
        retryEnabled: true,
        maximumAttempts: 3,
        retryIntervalsDays: [1, 2],
        autoCollectCategories: ['RECURRING_RENTAL'],
        maximumAutoDebit: null,
        walletFirst,
      }),
    },
    riderPaymentProfile: {
      findUnique: vi.fn().mockResolvedValue({ autoPayEnabled: true }),
    },
    paymentTransaction: { findMany: vi.fn().mockResolvedValue(transactions) },
    paymentMandate: { findFirst: vi.fn().mockResolvedValue({ maxAmount: new Prisma.Decimal('5000.00') }) },
    autoPayDunningCase: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const orchestrator = { collect: vi.fn().mockResolvedValue({}) };
  const wallet = { settle: vi.fn().mockResolvedValue(invoice) };
  const service = new AutoCollectionService(
    prisma as never,
    orchestrator as never,
    {} as never,
    {} as never,
    wallet as never,
  );
  return { service, orchestrator, wallet, prisma };
}
describe('automatic collection retry policy', () => {
  it('maps a custom India time to the configured due date', () => {
    const date = collectionDate(
      {
        collectionTiming: 'CUSTOM',
        beforeDueDays: 0,
        collectionHourIst: 9,
        collectionMinuteIst: 30,
      },
      invoice,
      new Date('2026-09-27T00:00:00Z'),
    );
    expect(date.toISOString()).toBe('2026-09-29T04:00:00.000Z');
  });
  it('does not retry a failed collection without an explicit retryable classification', async () => {
    const { service, orchestrator } = fixture([
      {
        status: 'FAILED',
        retryability: 'UNKNOWN',
        updatedAt: new Date('2026-09-20T00:00:00Z'),
      },
    ]);
    await service.processDue(10, new Date('2026-09-27T00:00:00Z'));
    expect(orchestrator.collect).not.toHaveBeenCalled();
  });
  it('retries a classified transient failure with a new idempotency key', async () => {
    const { service, orchestrator } = fixture([
      {
        status: 'FAILED',
        retryability: 'RETRYABLE',
        updatedAt: new Date('2026-09-20T00:00:00Z'),
      },
    ]);
    await service.processDue(10, new Date('2026-09-27T00:00:00Z'));
    expect(orchestrator.collect).toHaveBeenCalledWith(
      invoice.clientId,
      invoice.riderId,
      invoice.id,
      'autopay:invoice-1:2',
      expect.any(String),
    );
  });
  it('settles wallet funds before scheduling the remaining provider charge', async () => {
    const { service, orchestrator, wallet, prisma } = fixture([], true);
    prisma.riderInvoice.findFirst.mockResolvedValue({ ...invoice, outstandingAmount: new Prisma.Decimal('400.00') });
    await service.processDue(10, new Date('2026-09-27T00:00:00Z'));
    expect(wallet.settle).toHaveBeenCalledWith(invoice.clientId, invoice.id, 'SYSTEM', `autopay:wallet:${invoice.id}:1:2026-09-27`);
    expect(orchestrator.collect).toHaveBeenCalledOnce();
    expect(wallet.settle.mock.invocationCallOrder[0]).toBeLessThan(orchestrator.collect.mock.invocationCallOrder[0]);
  });
  it('does not request a debit when wallet settlement pays the full invoice', async () => {
    const { service, orchestrator, wallet, prisma } = fixture([], true);
    prisma.riderInvoice.findFirst.mockResolvedValue({ ...invoice, outstandingAmount: new Prisma.Decimal('0.00') });
    await service.processDue(10, new Date('2026-09-27T00:00:00Z'));
    expect(wallet.settle).toHaveBeenCalledOnce();
    expect(orchestrator.collect).not.toHaveBeenCalled();
  });
  it('requires rider action instead of debiting without a valid active mandate', async () => {
    const { service, orchestrator, wallet, prisma } = fixture([], true);
    prisma.paymentMandate.findFirst.mockResolvedValue(null);
    await service.processDue(10, new Date('2026-09-27T00:00:00Z'));
    expect(wallet.settle).not.toHaveBeenCalled();
    expect(orchestrator.collect).not.toHaveBeenCalled();
    expect(prisma.autoPayDunningCase.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'RIDER_ACTION_REQUIRED', failureCode: 'MANDATE_NOT_ACTIVE' }),
    }));
  });
});
