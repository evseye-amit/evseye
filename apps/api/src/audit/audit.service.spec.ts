import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('returns a client-scoped paginated audit log', async () => {
    const auditId = 9007199254740993n;
    const findMany = vi.fn().mockReturnValue({ query: 'items' });
    const count = vi.fn().mockReturnValue({ query: 'count' });
    const transaction = vi.fn().mockResolvedValue([
      [
        {
          id: auditId,
          actorId: 'actor-1',
          entityType: 'FLEET',
          entityId: 'fleet-1',
        },
      ],
      1,
    ]);
    const service = new AuditService({
      auditLog: { findMany, count },
      $transaction: transaction,
      user: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'actor-1', name: 'Manager' }]),
      },
      fleet: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'fleet-1', vehicleNumber: 'EV001' }]),
      },
      rider: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const result = await service.list('client-a', 2, 200);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      items: [
        {
          id: auditId.toString(),
          actorId: 'actor-1',
          entityType: 'FLEET',
          entityId: 'fleet-1',
          actorName: 'Manager',
          entityName: 'EV001',
        },
      ],
      meta: { page: 2, pageSize: 100, total: 1 },
    });
    expect(result.items[0]?.id).toBe(auditId.toString());
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
