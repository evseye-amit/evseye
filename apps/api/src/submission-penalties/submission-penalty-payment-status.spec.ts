import { describe, expect, it, vi } from 'vitest';
import { Prisma, type RiderInvoice } from '@prisma/client';
import {
  SubmissionPenaltyService,
  pendingPenaltySummary,
} from './submission-penalty.service.js';

const D = (amount: string) => new Prisma.Decimal(amount);
function invoice(
  id: string,
  paid: string,
  credit: string,
  outstanding: string,
  status: RiderInvoice['status'] = 'FINALIZED',
): RiderInvoice {
  return {
    id,
    clientId: 'client-1',
    riderId: 'rider-1',
    invoiceNumber: id,
    invoiceType: 'SUBMISSION_PENALTY',
    penaltyNotificationQueuedAt: null,
    sourceKey: null,
    agreementId: null,
    billingPeriodId: null,
    issuedAt: null,
    taxSnapshot: null,
    finalizedAt: null,
    paidAt: null,
    billingPeriodStart: new Date('2026-10-23'),
    billingPeriodEnd: new Date('2026-10-24'),
    dueDate: new Date('2026-10-24'),
    subtotal: D(paid).plus(credit).plus(outstanding),
    creditAmount: D('0'),
    adjustmentAmount: D('0'),
    taxAmount: D('0'),
    currency: 'INR',
    status,
    totalAmount: D(paid).plus(credit).plus(outstanding),
    paidAmount: D(paid),
    appliedSettlementCreditAmount: D(credit),
    outstandingAmount: D(outstanding),
    pricingSnapshot: {
      penalties: [{ name: 'Damaged part', amount: '500.00' }],
    },
    createdAt: new Date('2026-10-24T00:00:00Z'),
  };
}
const cases = [
  {
    name: 'no payment',
    row: invoice('unpaid', '0', '0', '500'),
    expected: 'UNPAID',
  },
  {
    name: 'partial payment',
    row: invoice('partial', '200', '0', '300', 'PARTIALLY_PAID'),
    expected: 'UNPAID',
  },
  {
    name: 'full payment',
    row: invoice('paid', '500', '0', '0', 'PAID'),
    expected: 'PAID',
  },
  {
    name: 'fully settled by credit',
    row: invoice('credit', '0', '500', '0', 'PAID'),
    expected: 'PAID',
  },
  {
    name: 'partly settled by credit',
    row: invoice('partial-credit', '0', '200', '300'),
    expected: 'UNPAID',
  },
  {
    name: 'mixed payment and credit',
    row: invoice('mixed', '300', '200', '0', 'PAID'),
    expected: 'PAID',
  },
  {
    name: 'one paisa remaining',
    row: invoice('remainder', '499.99', '0', '0.01', 'OVERDUE'),
    expected: 'UNPAID',
  },
];
function fixture(rows: RiderInvoice[]) {
  const db = {
    riderInvoice: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(rows.length),
      findFirst: vi.fn().mockResolvedValue(rows[0]),
      groupBy: vi.fn(),
    },
    vehicleSubmission: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'submission-1', riderId: 'rider-1' }),
    },
    paymentCollectionRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    paymentTransaction: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(db)),
  };
  const service = new SubmissionPenaltyService(db as never);
  return { db, service };
}
describe('submission penalty settlement response contract', () => {
  it.each(cases)(
    'returns the same binary status for $name in list, detail and submission responses',
    async ({ row, expected }) => {
      const f = fixture([row]);
      const list = await f.service.list('client-1', 'rider-1', 1, 100, true);
      const detail = await f.service.get('client-1', 'rider-1', row.id);
      const submission = await f.service.submissionStatus(
        'client-1',
        { id: 'admin-1', roles: ['CLIENT_ADMIN'] } as never,
        'submission-1',
      );
      for (const response of [
        list.data[0],
        detail,
        submission.paymentRequests[0],
      ]) {
        expect(response).toMatchObject({
          paymentStatus: expected,
          status: row.status,
          paidAmount: row.paidAmount.toFixed(2),
          settledCreditAmount: row.appliedSettlementCreditAmount.toFixed(2),
          outstandingAmount: row.outstandingAmount.toFixed(2),
          breakdown: row.pricingSnapshot,
        });
      }
      expect(list.meta).toEqual({ page: 1, limit: 100, total: 1 });
      expect(f.db.riderInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId: 'client-1',
            riderId: 'rider-1',
            invoiceType: 'SUBMISSION_PENALTY',
          },
          skip: 0,
          take: 100,
        }),
      );
    },
  );
  it('keeps the PENDING filter selecting outstanding invoices and preserves pagination', async () => {
    const f = fixture([cases[1].row]);
    const result = await f.service.list('client-1', 'rider-1', 2, 25);
    expect(result.data[0].paymentStatus).toBe('UNPAID');
    expect(f.db.riderInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,
        take: 25,
        where: expect.objectContaining({
          status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] },
          outstandingAmount: { gt: 0 },
        }),
      }),
    );
  });
  it('uses UNPAID in home pending requests and preserves total debt and payment purpose', async () => {
    const row = cases[1].row;
    const f = fixture([row]);
    f.db.riderInvoice.groupBy.mockResolvedValue([
      { currency: 'INR', _sum: { outstandingAmount: row.outstandingAmount } },
    ]);
    const result = await pendingPenaltySummary(
      f.db as never,
      'client-1',
      'rider-1',
    );
    expect(result).toMatchObject({
      pendingCount: 1,
      outstanding: [{ currency: 'INR', amount: '300.00' }],
      paymentRequests: [{ paymentStatus: 'UNPAID', paidAmount: '200.00' }],
      paymentPurpose: 'SUBMISSION_PENALTY',
      partialPaymentAllowed: true,
    });
  });
  it.each(['PENDING', 'FAILED', 'UNKNOWN', 'SUCCESS'])(
    'does not derive settlement from a %s gateway attempt',
    async (status) => {
      const f = fixture([cases[1].row]);
      f.db.riderInvoice.groupBy.mockResolvedValue([
        {
          currency: 'INR',
          _sum: {
            totalAmount: D('500'),
            paidAmount: D('200'),
            appliedSettlementCreditAmount: D('0'),
            outstandingAmount: D('300'),
          },
        },
      ]);
      f.db.paymentCollectionRequest.findFirst.mockResolvedValue({
        id: 'collection-1',
        amount: D('200'),
        currency: 'INR',
        status,
        provider: 'RAZORPAY',
        providerOrderId: 'order_test',
      } as never);
      const result = await f.service.summary('client-1', 'rider-1');
      expect(result.totals[0]).toMatchObject({
        paymentStatus: 'UNPAID',
        paidAmount: '200.00',
        outstandingAmount: '300.00',
      });
      expect(result.paymentInProgress?.status).toBe(status);
    },
  );
  it('reports PAID per currency for fully settled summary totals, including settlement credits', async () => {
    const f = fixture([]);
    f.db.riderInvoice.groupBy.mockResolvedValue([
      {
        currency: 'INR',
        _sum: {
          totalAmount: D('500'),
          paidAmount: D('300'),
          appliedSettlementCreditAmount: D('200'),
          outstandingAmount: D('0'),
        },
      },
    ]);
    const result = await f.service.summary('client-1', 'rider-1');
    expect(result.totals[0]).toMatchObject({
      paymentStatus: 'PAID',
      paidAmount: '300.00',
      settledCreditAmount: '200.00',
      outstandingAmount: '0.00',
    });
    expect(result.payNowAvailable).toBe(false);
  });
});
