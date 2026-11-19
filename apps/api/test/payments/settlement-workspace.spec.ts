import { describe, expect, it, vi } from 'vitest';
import { ProviderSettlementService } from '../../src/payments/provider-settlement.service.js';
import { PaymentAlertService } from '../../src/payments/payment-alert.service.js';

describe('settlement workspace queries', () => {
  it('applies client, search, gateway, matching status and UTC date range before pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ProviderSettlementService({ providerSettlement: { findMany } } as never);
    await service.list('client-a', 2, { search: ' SETTLE ', provider: 'RAZORPAY', status: 'REPORT_MATCHED', from: '2026-11-01', to: '2026-11-15' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-a', providerSettlementId: { contains: 'SETTLE', mode: 'insensitive' }, provider: 'RAZORPAY', status: 'REPORT_MATCHED',
        settledAt: { gte: new Date('2026-11-01T00:00:00Z'), lt: new Date('2026-11-16T00:00:00Z') } },
      skip: 200, take: 201,
    }));
  });
  it('rejects invalid dates, inverted ranges and unknown enum filters', async () => {
    const findMany = vi.fn();
    const service = new ProviderSettlementService({ providerSettlement: { findMany } } as never);
    for (const filters of [{ from: '2026-02-30' }, { from: 'not-a-date' }, { from: '2026-11-15', to: '2026-11-01' }, { provider: 'OTHER' }, { status: 'INVALID' }]) {
      await expect(service.list('client-a', 1, filters)).rejects.toThrow();
    }
    expect(findMany).not.toHaveBeenCalled();
  });
  it('keeps legacy unfiltered list contract', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ProviderSettlementService({ providerSettlement: { findMany } } as never);
    expect(await service.list('client-a')).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a' }, skip: 0, take: 200 }));
  });
  it('scopes settlement alerts and unacknowledged count independently of the page', async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: String(i) })));
    const count = vi.fn().mockResolvedValue(250);
    const service = new PaymentAlertService({ paymentOperationalAlert: { findMany, count } } as never, {} as never);
    const result = await service.settlementAlerts('client-a', 2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a', kind: 'SETTLEMENT_REVIEW' }, skip: 100, take: 101 }));
    expect(count).toHaveBeenCalledWith({ where: { clientId: 'client-a', kind: 'SETTLEMENT_REVIEW', acknowledgedAt: null } });
    expect(result.items).toHaveLength(100);
    expect(result).toMatchObject({ hasMore: true, unacknowledgedCount: 250 });
  });
});
