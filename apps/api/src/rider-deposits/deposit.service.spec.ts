import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RiderDepositService } from './deposit.service.js';
import {
  pricingHash,
  sha256,
} from '../rider-rate-cards/commercial-snapshot.js';

const D = Prisma.Decimal;
const clientId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const agreementId = '33333333-3333-4333-8333-333333333333';
const depositId = '44444444-4444-4444-8444-444444444444';
const actorId = '55555555-5555-4555-8555-555555555555';
const snapshot = {
  currency: 'INR',
  effectiveDate: '2026-09-27',
  rateCard: { id: 'card', code: 'C', versionId: 'v1', version: 1 },
  rider: { id: riderId },
  vehicle: { id: 'vehicle' },
  rental: { finalAmount: '1400.00', period: 'WEEKLY' },
  totals: {
    recurringAmount: '1400.00',
    payableToday: '2900.00',
    refundableDepositAmount: '1500.00',
  },
  adjustments: [],
  deposits: [
    {
      type: 'VEHICLE_SECURITY',
      code: 'V',
      ruleId: 'rule-v1',
      originalRequired: '2000.00',
      adjustedRequired: '2000.00',
      waiverAmount: '500.00',
      finalRequired: '1500.00',
    },
  ],
};
function fixture() {
  const row = {
    id: depositId,
    clientId,
    riderId,
    agreementId,
    vehicleId: 'vehicle',
    depositType: 'VEHICLE_SECURITY',
    currency: 'INR',
    status: 'REQUIRED',
    requiredAmount: new D('1500'),
    fundedAmount: new D(0),
    availableAmount: new D(0),
  };
  const transactions: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: depositId }]),
    riderDeposit: {
      findFirst: vi.fn().mockImplementation(async () => ({ ...row })),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(async ({ data }) => ({ ...data, id: depositId })),
      update: vi
        .fn()
        .mockImplementation(async ({ data }) => Object.assign(row, data)),
    },
    riderDepositTransaction: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async ({ where }) =>
            transactions.find(
              (item) =>
                item.idempotencyKey ===
                where.clientId_idempotencyKey?.idempotencyKey,
            ) ?? null,
        ),
      findFirst: vi.fn(),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const item = { ...data, id: `transaction-${transactions.length + 1}` };
        transactions.push(item);
        return item;
      }),
    },
    riderRentalAgreement: {
      findFirst: vi.fn().mockResolvedValue({
        id: agreementId,
        clientId,
        riderId,
        vehicleId: 'vehicle',
        currency: 'INR',
        pricingSnapshot: snapshot,
        pricingSnapshotSchemaVersion: 1,
        pricingHash: pricingHash(clientId, snapshot, sha256('terms'), 'T@1'),
        termsHash: sha256('terms'),
        termsVersion: 'T@1',
      }),
    },
    riderLedgerEntry: { create: vi.fn().mockResolvedValue({}) },
    settlementDepositHold: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    riderDepositRefundRequest: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)),
  };
  return {
    service: new RiderDepositService(prisma as never),
    tx,
    row,
    transactions,
  };
}
describe('rider deposits', () => {
  it('initializes obligations from the accepted agreement snapshot and preserves the waiver', async () => {
    const { service, tx } = fixture();
    const result = await service.initializeAgreement(
      clientId,
      actorId,
      agreementId,
    );
    expect(result).toHaveLength(1);
    const data = tx.riderDeposit.create.mock.calls[0][0].data;
    expect(data.requiredAmount.toFixed(2)).toBe('1500.00');
    expect(data.waiverAmount.toFixed(2)).toBe('500.00');
    expect(
      tx.riderDepositTransaction.create.mock.calls[0][0].data.transactionType,
    ).toBe('WAIVER');
    expect(tx.riderLedgerEntry.create).not.toHaveBeenCalled();
  });
  it('posts a partial collection with a linked liability entry and replays the same key once', async () => {
    const { service, tx, row, transactions } = fixture();
    const input = { amount: '500.00', reason: 'Confirmed collection' };
    const first = await service.move(
      clientId,
      actorId,
      depositId,
      input,
      'collect-1',
      'COLLECTION',
    );
    const replay = await service.move(
      clientId,
      actorId,
      depositId,
      input,
      'collect-1',
      'COLLECTION',
    );
    expect(replay.id).toBe(first.id);
    expect(transactions).toHaveLength(1);
    expect(row.availableAmount.toFixed(2)).toBe('500.00');
    expect(row.fundedAmount.toFixed(2)).toBe('500.00');
    expect(row.status).toBe('PARTIALLY_COLLECTED');
    expect(tx.riderLedgerEntry.create.mock.calls[0][0].data.category).toBe(
      'REFUNDABLE_DEPOSIT_LIABILITY',
    );
  });
  it('rejects overcollection and an unexplained deduction without posting history', async () => {
    const { service, transactions } = fixture();
    await expect(
      service.move(
        clientId,
        actorId,
        depositId,
        { amount: '1600.00', reason: 'Too much' },
        'collect-2',
        'COLLECTION',
      ),
    ).rejects.toThrow();
    await expect(
      service.move(
        clientId,
        actorId,
        depositId,
        { amount: '100.00', reason: 'Damage' },
        'deduct-1',
        'DEDUCTION',
      ),
    ).rejects.toThrow();
    expect(transactions).toHaveLength(0);
  });
  it('reverses an authorized deduction without changing the original transaction', async () => {
    const { service, tx, row, transactions } = fixture();
    await service.move(
      clientId,
      actorId,
      depositId,
      { amount: '500.00', reason: 'Confirmed collection' },
      'collect-3',
      'COLLECTION',
    );
    const deduction = await service.move(
      clientId,
      actorId,
      depositId,
      {
        amount: '100.00',
        reason: 'Damage',
        referenceType: 'ASSESSMENT',
        referenceId: 'assessment-1',
      },
      'deduct-3',
      'DEDUCTION',
    );
    tx.riderDepositTransaction.findFirst.mockResolvedValue(deduction);
    const reversal = await service.reverse(
      clientId,
      actorId,
      deduction.id,
      { reason: 'Assessment cancelled' },
      'reverse-3',
    );
    expect(reversal.transactionType).toBe('REVERSAL');
    expect(reversal.reversalOfTransactionId).toBe(deduction.id);
    expect(row.availableAmount.toFixed(2)).toBe('500.00');
    expect(transactions).toHaveLength(3);
  });
  it('requires held cash for activation and excludes a pending refund', async () => {
    const row = {
      id: depositId,
      clientId,
      agreementId,
      riderId,
      requiredAmount: new D('1500'),
      fundedAmount: new D('1500'),
      availableAmount: new D('1500'),
    };
    const prisma = {
      riderRentalAgreement: {
        findFirst: vi.fn().mockResolvedValue({
          id: agreementId,
          pricingSnapshot: snapshot,
          pricingSnapshotSchemaVersion: 1,
        }),
      },
      riderDeposit: { findMany: vi.fn().mockResolvedValue([row]) },
      riderDepositRefundRequest: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { amount: new D('500') } }),
      },
      client: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          depositActivationPolicy: 'FULL_REQUIRED',
          depositActivationThreshold: null,
        }),
      },
    };
    const service = new RiderDepositService(prisma as never);
    expect((await service.readiness(clientId, agreementId)).satisfied).toBe(
      false,
    );
    prisma.riderDepositRefundRequest.aggregate.mockResolvedValue({
      _sum: { amount: new D(0) },
    });
    expect((await service.readiness(clientId, agreementId)).satisfied).toBe(
      true,
    );
  });
  it('hides deposits outside the authenticated client and rider scope', async () => {
    const prisma = {
      riderDeposit: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new RiderDepositService(prisma as never);
    await expect(service.get(clientId, depositId, riderId)).rejects.toThrow();
    expect(prisma.riderDeposit.findFirst).toHaveBeenCalledWith({
      where: { clientId, id: depositId, riderId },
    });
  });
});
