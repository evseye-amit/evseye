import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ListRidersDto } from './dto/list-riders.dto.js';
import { RidersService } from './riders.service.js';

describe('RidersService client isolation', () => {
  it('looks up a rider with both its ID and the authenticated client ID', async () => {
    const prisma = {
      rider: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new RidersService(prisma as never, {} as never, {} as never);

    await expect(
      service.getById('client-a', 'rider-owned-by-client-b'),
    ).rejects.toThrow('Rider not found');
    expect(prisma.rider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'rider-owned-by-client-b',
          clientId: 'client-a',
          deletedAt: null,
        },
      }),
    );
  });
});

describe('RidersService table allocation details', () => {
  it('loads current fleet identifiers and work partner while excluding completed allocations', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { rider: { findMany, count: vi.fn().mockResolvedValue(0) }, $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)) };
    const service = new RidersService(prisma as never, {} as never, { decorate: vi.fn(async (_client: string, rows: unknown[]) => rows) } as never);
    await service.list('client-a', new ListRidersDto());
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-a', deletedAt: null },
      include: { allocations: {
        where: { clientId: 'client-a', status: { in: ['INSPECTION_PENDING', 'OTP_PENDING', 'ACTIVE', 'DEALLOCATION_INITIATED'] } },
        orderBy: { createdAt: 'desc' }, take: 1,
        select: { id: true, status: true, mobileDeployment: { select: { workPartnerName: true, clientWorkPartner: { select: { name: true } } } },
          fleet: { select: { fleetCode: true, vehicleNumber: true, currentHub: { select: { name: true } }, homeHub: { select: { name: true } } } } },
      } },
    }));
  });
  it('scopes work partner search to the client and current allocations', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { rider: { findMany, count }, $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)) };
    const service = new RidersService(prisma as never, {} as never, { decorate: vi.fn(async (_client: string, rows: unknown[]) => rows) } as never);
    await service.list('client-a', Object.assign(new ListRidersDto(), { search: 'Partner' }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ allocations: { some: {
      clientId: 'client-a', status: { in: ['ACTIVE', 'INSPECTION_PENDING', 'OTP_PENDING', 'DEALLOCATION_INITIATED'] },
      mobileDeployment: { is: { OR: [
        { workPartnerName: { contains: 'Partner', mode: 'insensitive' } },
        { clientWorkPartner: { is: { clientId: 'client-a', name: { contains: 'Partner', mode: 'insensitive' } } } },
      ] } },
    } } });
    expect(count).toHaveBeenCalledWith({ where });
  });
});
