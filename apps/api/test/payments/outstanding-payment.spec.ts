import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  parseOutstandingInput,
  planPenaltyPayment,
  readPenaltySnapshot,
} from '../../src/payments/outstanding-payment.js';
import { SubmissionPenaltyService } from '../../src/submission-penalties/submission-penalty.service.js';
import { RiderSubmissionPenaltyController } from '../../src/submission-penalties/submission-penalty.controller.js';
const D = (value: string) => new Prisma.Decimal(value);
describe('consolidated penalty payment contract', () => {
  it('keeps omitted input compatible and normalizes decimal strings', () => {
    expect(parseOutstandingInput(undefined)).toEqual({
      scope: 'ALL',
      requestedAmount: null,
    });
    expect(
      parseOutstandingInput({ scope: 'SUBMISSION_PENALTY', amount: '500.5' }),
    ).toEqual({ scope: 'SUBMISSION_PENALTY', requestedAmount: '500.50' });
  });
  it.each([
    0,
    500,
    '',
    '-1',
    '0',
    '0.99',
    '1.001',
    '1e2',
    'Infinity',
    '01',
    '1000000000000',
  ])('rejects invalid amount %j', (amount) => {
    expect(() =>
      parseOutstandingInput({ scope: 'SUBMISSION_PENALTY', amount }),
    ).toThrow();
  });
  it('rejects extra fields and unknown scopes', () => {
    expect(() =>
      parseOutstandingInput({ riderId: 'foreign', amount: '10' }),
    ).toThrow();
    expect(() => parseOutstandingInput({ scope: 'RENTAL' })).toThrow();
  });
  it('splits a partial payment over an ordered snapshot and detects invalid plans', () => {
    const allocations = planPenaltyPayment(
      [
        { id: 'old', outstandingAmount: D('300') },
        { id: 'new', outstandingAmount: D('900') },
      ],
      D('500'),
    );
    expect(allocations).toEqual([
      { invoiceId: 'old', amount: '300.00' },
      { invoiceId: 'new', amount: '200.00' },
    ]);
    const snapshot = {
      version: 1,
      scope: 'SUBMISSION_PENALTY',
      requestedAmount: '500.00',
      outstandingBeforePayment: '1200.00',
      externalPaymentRequested: '500.00',
      allocations,
    };
    expect(readPenaltySnapshot(snapshot, D('500')).allocations).toEqual(
      allocations,
    );
    expect(() => readPenaltySnapshot(snapshot, D('600'))).toThrow(
      'SNAPSHOT_INVALID',
    );
    expect(() =>
      readPenaltySnapshot(
        { ...snapshot, allocations: [allocations[0], allocations[0]] },
        D('600'),
      ),
    ).toThrow('SNAPSHOT_INVALID');
  });
  it('summarizes every penalty invoice independently of pagination and exposes in-progress payments', async () => {
    const tx = {
      riderInvoice: {
        groupBy: vi.fn().mockResolvedValue([
          {
            currency: 'INR',
            _sum: {
              totalAmount: D('1500'),
              paidAmount: D('200'),
              appliedSettlementCreditAmount: D('100'),
              outstandingAmount: D('1200'),
            },
          },
        ]),
        count: vi.fn().mockResolvedValue(50),
      },
      paymentCollectionRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'checkout',
          amount: D('500'),
          currency: 'INR',
          status: 'PENDING',
        }),
      },
      paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const db = {
      $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
    };
    const service = new SubmissionPenaltyService(db as never);
    expect(await service.summary('client', 'rider')).toMatchObject({
      totals: [{ outstandingAmount: '1200.00', settledCreditAmount: '100.00' }],
      pendingCount: 50,
      defaultAmount: '1200.00',
      payNowAvailable: false,
      paymentInProgress: { amount: '500.00' },
    });
    expect(tx.riderInvoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client',
          riderId: 'rider',
          invoiceType: 'SUBMISSION_PENALTY',
        }),
      }),
    );
    expect(tx.riderInvoice.groupBy.mock.calls[0][0]).not.toHaveProperty('take');
    tx.riderInvoice.groupBy.mockResolvedValue([]);
    tx.paymentCollectionRequest.findFirst.mockResolvedValue(null);
    expect(await service.summary('client', 'rider')).toMatchObject({
      defaultAmount: '0.00',
      payNowAvailable: false,
    });
  });
  it('uses only the authenticated Rider for summary access', async () => {
    const service = {
      rider: vi.fn().mockResolvedValue('rider'),
      summary: vi.fn().mockResolvedValue({ pendingCount: 1 }),
    };
    const controller = new RiderSubmissionPenaltyController(
      service as never,
      { requireClientId: vi.fn().mockReturnValue('client') } as never,
    );
    expect(
      await controller.summary({
        id: 'user',
        clientId: 'client',
        roles: ['RIDER'],
      }),
    ).toEqual({ data: { pendingCount: 1 } });
    expect(service.rider).toHaveBeenCalledWith('client', 'user');
    expect(service.summary).toHaveBeenCalledWith('client', 'rider');
  });
});
