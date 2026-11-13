import { describe, expect, it } from 'vitest';
import { normalizeRazorpaySettlement } from '../../src/payments/settlement-ingestion.service.js';
import { normalizeCashfreeSettlement } from '../../src/payments/cashfree/cashfree-settlement.js';
const detail = {
  id: 'setl_one',
  status: 'processed',
  amount: 8820,
  utr: 'BANK12345',
};
const row = {
  entity_id: 'pay_one',
  type: 'payment',
  amount: 10000,
  credit: 8820,
  debit: 0,
  fee: 1180,
  tax: 180,
  currency: 'INR',
  settled: true,
  on_hold: false,
  settlement_id: 'setl_one',
  settled_at: 1700000000,
  settlement_utr: 'BANK12345',
};
describe('gateway statement normalization', () => {
  it('separates tax from inclusive Razorpay fees and checks bank payout total', () => {
    expect(
      normalizeRazorpaySettlement('setl_one', detail, [row]),
    ).toMatchObject({
      grossAmount: '100.00',
      netAmount: '88.20',
      feeAmount: '10.00',
      taxAmount: '1.80',
    });
  });
  it.each([
    { type: 'transfer' },
    { settlement_id: 'setl_other' },
    { settlement_utr: 'OTHER' },
    { credit: 9900 },
    { currency: 'USD' },
    { settled: false },
  ])('rejects incomplete/unsupported/mismatched rows %j', (change) => {
    expect(() =>
      normalizeRazorpaySettlement('setl_one', detail, [{ ...row, ...change }]),
    ).toThrow();
  });
  it('normalizes a Cashfree credit with separately reported fee and tax', () => {
    const cf = {
      event_details: {
        event_type: 'PAYMENT',
        event_status: 'SUCCESS',
        event_currency: 'INR',
        event_amount: 100,
        event_service_charge: 10,
        event_service_tax: 1.8,
        event_settlement_amount: 88.2,
        sale_type: 'CREDIT',
      },
      payment_details: { cf_payment_id: '123' },
      settlement_details: {
        cf_settlement_id: '456',
        settlement_date: '2026-01-01T12:00:00+05:30',
        settlement_utr: 'BANK456',
      },
    };
    expect(normalizeCashfreeSettlement('456', [cf])).toMatchObject({
      netAmount: '88.20',
      feeAmount: '10.00',
      taxAmount: '1.80',
    });
    expect(() => normalizeCashfreeSettlement('other', [cf])).toThrow();
    expect(() =>
      normalizeCashfreeSettlement('456', [
        {
          ...cf,
          event_details: { ...cf.event_details, event_type: 'DISPUTE' },
        },
      ]),
    ).toThrow();
  });
});

import { vi } from 'vitest';
import { SettlementIngestionService } from '../../src/payments/settlement-ingestion.service.js';
describe('direct settlement fetch', () => {
  function fixture() {
    const gateway = {
      settlement: vi.fn().mockResolvedValue(detail),
      settlementRecon: vi.fn().mockResolvedValue({ items: [row] }),
    };
    const configurations = {
      resolveVersion: vi
        .fn()
        .mockResolvedValue({ configurationVersionId: 'v1' }),
    };
    const settlements = {
        importReport: vi.fn().mockResolvedValue({ id: 'report' }),
      },
      alerts = { raise: vi.fn() };
    return {
      gateway,
      configurations,
      settlements,
      alerts,
      service: new SettlementIngestionService(
        gateway as never,
        configurations as never,
        settlements as never,
        {} as never,
        {} as never,
        alerts as never,
      ),
    };
  }
  const input = {
    provider: 'RAZORPAY',
    configurationVersionId: 'v1',
    settlementId: 'setl_one',
    date: '2026-01-01',
  };
  it('fetches every page before importing and retains merchant provenance', async () => {
    const f = fixture();
    f.gateway.settlementRecon.mockResolvedValueOnce({
      items: Array.from({ length: 100 }, () => ({
        ...row,
        settlement_id: 'setl_other',
      })),
    });
    await f.service.ingest('client', 'admin', input);
    expect(f.configurations.resolveVersion).toHaveBeenCalledWith(
      'client',
      'v1',
      'RAZORPAY',
    );
    expect(f.gateway.settlementRecon).toHaveBeenNthCalledWith(
      2,
      '2026-01-01',
      100,
      'client',
      'v1',
    );
    expect(f.settlements.importReport).toHaveBeenCalledWith(
      'client',
      'admin',
      expect.objectContaining({
        items: [
          { kind: 'PAYMENT', providerReference: 'pay_one', amount: '100.00' },
        ],
      }),
      { configurationVersionId: 'v1' },
    );
  });
  it('does not fetch when the merchant version belongs to another tenant', async () => {
    const f = fixture();
    f.configurations.resolveVersion.mockRejectedValue(
      new Error('wrong tenant'),
    );
    await expect(f.service.ingest('other', 'admin', input)).rejects.toThrow(
      'wrong tenant',
    );
    expect(f.gateway.settlement).not.toHaveBeenCalled();
    expect(f.settlements.importReport).not.toHaveBeenCalled();
  });
  it('routes unsupported report content for review without importing partial rows', async () => {
    const f = fixture();
    f.gateway.settlementRecon.mockResolvedValue({
      items: [{ ...row, type: 'adjustment' }],
    });
    await expect(f.service.ingest('client', 'admin', input)).rejects.toThrow(
      'REQUIRES_REVIEW',
    );
    expect(f.settlements.importReport).not.toHaveBeenCalled();
    expect(f.alerts.raise).toHaveBeenCalledWith(
      'client',
      'SETTLEMENT_INGESTION_FAILED',
      'setl_one',
    );
  });
});
