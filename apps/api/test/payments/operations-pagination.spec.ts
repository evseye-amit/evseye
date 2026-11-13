import { describe, expect, it } from 'vitest';
import { operationsPage, pageResult } from '../../src/payments/operations-pagination.js';
describe('operations pagination', () => {
  it('rejects malformed or excessive offsets', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '1000000', '1e2', '']) expect(() => operationsPage(value)).toThrow();
    expect(operationsPage()).toBe(1);
    expect(operationsPage('3')).toBe(3);
  });
  it('reports exact-boundary exhaustion and strips lookahead rows', () => {
    expect(pageResult([1, 2], 1, 2)).toEqual({ items: [1, 2], page: 1, hasMore: false });
    expect(pageResult([1, 2, 3], 2, 2)).toEqual({ items: [1, 2], page: 2, hasMore: true });
  });
});

import { vi } from 'vitest';
import { AutoPayOperationsController } from '../../src/payments/autopay-operations.controller.js';
import { ProviderSettlementService } from '../../src/payments/provider-settlement.service.js';
describe('list API backward compatibility', () => {
  it('keeps legacy mandate arrays and pages only the authenticated client', async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: String(i) })));
    const controller = new AutoPayOperationsController({ paymentMandate: { findMany } } as never, { requireClientId: () => 'client-a' } as never);
    const paged = await controller.mandates({} as never, '2');
    expect(paged.data).toMatchObject({ page: 2, hasMore: true });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-a' }, skip: 100, take: 101 }));
    findMany.mockResolvedValue([]);
    expect((await controller.mandates({} as never)).data).toEqual([]);
  });
  it('preserves settlement arrays and exposes explicit history metadata', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ProviderSettlementService({ providerSettlement: { findMany } } as never);
    expect(await service.list('client-a')).toEqual([]);
    expect(await service.list('client-a', 2)).toEqual({ items: [], page: 2, hasMore: false });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { clientId: 'client-a' }, skip: 200, take: 201 }));
  });
});
