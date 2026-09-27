import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CollectionsService } from './collections.service.js';

const now = new Date('2026-10-05T06:00:00.000Z');
const clientId = 'client-a';
const riderId = 'rider-a';
const invoice = {
  id: 'invoice-a',
  clientId,
  riderId,
  agreementId: null,
  dueDate: new Date('2026-10-01T00:00:00.000Z'),
  outstandingAmount: new Prisma.Decimal(1000),
  status: 'OVERDUE',
};
const policy = {
  id: 'version-a',
  clientId,
  gracePeriodDays: 2,
  timezone: 'Asia/Kolkata',
  dunningEnabled: true,
  autoPayRetryEnabled: false,
  restrictionEnabled: false,
  promiseHoldEnabled: false,
  stages: [
    {
      stageCode: 'REMINDER',
      daysFromDue: 3,
      displayOrder: 1,
      isActive: true,
      actions: ['PUSH_NOTIFICATION'],
    },
  ],
};
function fixture() {
  let current: Record<string, unknown> | null = null;
  let invoices = [invoice];
  const keys = new Set<string>();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: riderId }]),
    riderCollectionCase: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(current)),
      create: vi.fn().mockImplementation(({ data }) => {
        current = { id: 'case-a', ...data };
        return Promise.resolve(current);
      }),
      update: vi.fn().mockImplementation(({ data }) => {
        current = { ...current, ...data };
        return Promise.resolve(current);
      }),
    },
    collectionPolicyVersion: {
      findMany: vi.fn().mockResolvedValue([
        {
          ...policy,
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ]),
      findFirst: vi.fn().mockResolvedValue(policy),
    },
    riderInvoice: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(invoices)),
      count: vi.fn().mockResolvedValue(1),
    },
    collectionCaseInvoice: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([{ invoiceId: 'invoice-a' }]),
    },
    promiseToPay: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    riderPaymentAllocation: { findMany: vi.fn().mockResolvedValue([]) },
    collectionDispute: { findFirst: vi.fn().mockResolvedValue(null) },
    collectionAction: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        const key = data[0].idempotencyKey;
        const created = !keys.has(key);
        keys.add(key);
        return Promise.resolve({ count: created ? 1 : 0 });
      }),
    },
    commercialRestriction: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    collectionEvent: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)) };
  const service = new CollectionsService(db as never, {} as never, {} as never);
  return {
    service,
    tx,
    setInvoices: (value: typeof invoices) => {
      invoices = value;
    },
    keys,
  };
}
describe('collection case evaluation', () => {
  it('opens one case and queues each stage action once across repeat evaluations', async () => {
    const { service, tx, keys } = fixture();
    expect(await service.evaluate(clientId, riderId, now)).toBe('case-a');
    expect(await service.evaluate(clientId, riderId, now)).toBe('case-a');
    expect(tx.riderCollectionCase.create).toHaveBeenCalledTimes(1);
    expect(keys.size).toBe(1);
    expect(tx.collectionCaseInvoice.upsert).toHaveBeenCalledTimes(2);
    expect(tx.collectionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'COLLECTION_CASE_OPENED' }),
      }),
    );
  });
  it('marks an unpaid expired promise broken without altering invoice amounts', async () => {
    const { service, tx } = fixture();
    await service.evaluate(clientId, riderId, now);
    tx.promiseToPay.findMany.mockResolvedValueOnce([
      {
        id: 'promise-a',
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        promiseDate: new Date('2026-10-03T00:00:00.000Z'),
        promisedAmount: new Prisma.Decimal(500),
        status: 'ACTIVE',
      },
    ]);
    await service.evaluate(clientId, riderId, now);
    expect(tx.promiseToPay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'BROKEN', activeCaseId: null }),
      }),
    );
    expect(tx.riderInvoice.findMany).toHaveBeenCalled();
    expect(tx.riderInvoice.count).not.toHaveBeenCalled();
  });
  it('does not fulfill a promise with payment received after its deadline', async () => {
    const { service, tx } = fixture();
    await service.evaluate(clientId, riderId, now);
    tx.promiseToPay.findMany.mockResolvedValueOnce([
      {
        id: 'promise-late',
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
        promiseDate: new Date('2026-10-03T00:00:00.000Z'),
        promisedAmount: new Prisma.Decimal(500),
        status: 'ACTIVE',
      },
    ]);
    tx.riderPaymentAllocation.findMany.mockResolvedValueOnce([
      {
        amount: new Prisma.Decimal(500),
        payment: { receivedAt: new Date('2026-10-04T06:00:00.000Z') },
      },
    ]);
    await service.evaluate(clientId, riderId, now);
    expect(tx.promiseToPay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BROKEN',
          paidSince: new Prisma.Decimal(0),
        }),
      }),
    );
  });
  it('resolves after invoice payment and removes only this case restrictions', async () => {
    const { service, tx, setInvoices } = fixture();
    await service.evaluate(clientId, riderId, now);
    setInvoices([]);
    expect(await service.evaluate(clientId, riderId, now)).toBeNull();
    expect(tx.riderCollectionCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RESOLVED',
          activeRiderId: null,
        }),
      }),
    );
    expect(tx.commercialRestriction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ caseId: 'case-a', status: 'ACTIVE' }),
      }),
    );
  });
});
