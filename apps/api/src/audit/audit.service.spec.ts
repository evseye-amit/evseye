import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('returns a client-scoped paginated audit log', async () => {
    const findMany = vi.fn().mockReturnValue({ query: 'items' });
    const count = vi.fn().mockReturnValue({ query: 'count' });
    const transaction = vi.fn().mockResolvedValue([[{ id: 1n }], 1]);
    const service = new AuditService({
      auditLog: { findMany, count },
      $transaction: transaction,
    } as never);

    await expect(service.list('client-a', 2, 200)).resolves.toEqual({
      items: [{ id: 1n }],
      meta: { page: 2, pageSize: 100, total: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-a' },
        skip: 100,
        take: 100,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: { clientId: 'client-a' } });
  });
});
