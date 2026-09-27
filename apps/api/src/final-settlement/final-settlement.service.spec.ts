import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { FinalSettlementService } from './final-settlement.service.js';
const D = Prisma.Decimal;
const zero = new D(0);
const at = (s: string) => new Date(s);
const agreement = {
  id: 'agreement',
  clientId: 'client',
  riderId: 'rider',
  vehicleId: 'vehicle',
  currency: 'INR',
  status: 'TERMINATED',
  terminationEffectiveAt: at('2026-10-10T00:00:00Z'),
};
const version = {
  id: 'frozen',
  vehicleId: 'vehicle',
  pricingHash: 'hash',
  amendmentId: null,
  effectiveFrom: at('2026-10-01T00:00:00Z'),
  effectiveTo: null,
  billingStartAt: null,
  recurringAmount: new D(1400),
  pricingSnapshot: { rental: { period: 'WEEKLY' } },
};
function fixture() {
  const db = {
    riderRentalAgreement: { findFirst: vi.fn().mockResolvedValue(agreement) },
    rentalTerminationRequest: {
      findUnique: vi.fn().mockResolvedValue({
        actualTerminationDate: agreement.terminationEffectiveAt,
      }),
    },
    riderInvoice: {
      findMany: vi.fn().mockResolvedValue([{ outstandingAmount: new D(500) }]),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { outstandingAmount: new D(500) } }),
    },
    riderCredit: {
      findMany: vi.fn().mockResolvedValue([{ remainingAmount: new D(200) }]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { remainingAmount: zero } }),
    },
    riderCharge: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    riderPayment: {
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { unallocatedAmount: zero } }),
    },
    riderDeposit: {
      findMany: vi.fn().mockResolvedValue([{ availableAmount: new D(3000) }]),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { availableAmount: new D(3000) } }),
    },
    riderFinalSettlement: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue({
        id: 'settlement',
        clientId: 'client',
        riderId: 'rider',
        agreementId: agreement.id,
        billingCutoffAt: agreement.terminationEffectiveAt,
        status: 'APPROVED',
      }),
    },
    riderBillingSchedule: {
      findFirst: vi.fn().mockResolvedValue({
        nextPeriodStart: at('2026-10-08T00:00:00Z'),
        frequency: 'WEEKLY',
        timezone: 'UTC',
        customDays: null,
        anchorAt: at('2026-10-01T00:00:00Z'),
        status: 'ACTIVE',
      }),
    },
    riderAgreementCommercialVersion: {
      findMany: vi.fn().mockResolvedValue([version]),
    },
    settlementRefundRequest: { count: vi.fn().mockResolvedValue(0) },
    settlementDepositHold: { count: vi.fn().mockResolvedValue(0) },
  };
  const service = new FinalSettlementService(
    db as never,
    { reconcile: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { db, service };
}
describe('final settlement preview', () => {
  it('uses the frozen weekly version and the existing prorator for a two-day final period', async () => {
    const { service } = fixture();
    const preview = await service.preview('client', agreement.id);
    expect(preview.finalRentalEstimate).toBe('400.00');
    expect(preview.existingOutstanding).toBe('500.00');
    expect(preview.availableCredit).toBe('200.00');
    expect(preview.estimatedRefund).toBe('2300.00');
    expect(preview.estimated).toBe(true);
  });
  it('does not bill a period already advanced through the return date', async () => {
    const { service, db } = fixture();
    db.riderBillingSchedule.findFirst.mockResolvedValue({
      nextPeriodStart: agreement.terminationEffectiveAt,
      status: 'CLOSED',
    });
    expect(
      (await service.preview('client', agreement.id)).finalRentalEstimate,
    ).toBe('0.00');
  });
  it('blocks closure while a refund remains pending', async () => {
    const { service, db } = fixture();
    db.riderDeposit.aggregate.mockResolvedValue({
      _sum: { availableAmount: zero },
    });
    db.riderInvoice.aggregate.mockResolvedValue({
      _sum: { outstandingAmount: zero },
    });
    db.settlementRefundRequest.count.mockResolvedValue(1);
    await expect(
      service.close('client', 'settlement', 'checker'),
    ).rejects.toMatchObject({
      response: { code: 'FINANCIAL_CLOSURE_PENDING' },
    });
  });
});
