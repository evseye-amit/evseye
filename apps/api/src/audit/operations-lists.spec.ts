import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditService } from './audit.service.js';
import { ListAuditDto } from './list-audit.dto.js';
import { ListFleetsDto } from '../fleets/dto/list-fleets.dto.js';
import { ListRidersDto } from '../riders/dto/list-riders.dto.js';
import { FleetsService } from '../fleets/fleets.service.js';
import { RidersService } from '../riders/riders.service.js';

describe('Operations list contracts', () => {
  it.each([ListFleetsDto, ListRidersDto, ListAuditDto])(
    'rejects invalid sort keys and pagination for %s',
    async (Dto) => {
      const errors = await validate(
        plainToInstance<object, Record<string, unknown>>(Dto, {
          page: '-1',
          pageSize: '1000',
          sortBy: 'metadata',
          sortDirection: 'sideways',
        }),
      );
      expect(errors.map((error) => error.property)).toEqual(
        expect.arrayContaining(['page', 'pageSize', 'sortBy', 'sortDirection']),
      );
      expect(
        await validate(
          plainToInstance<object, Record<string, unknown>>(Dto, {
            page: '2',
            pageSize: '25',
            sortBy: 'createdAt',
            sortDirection: 'desc',
          }),
        ),
      ).toEqual([]);
    },
  );

  it('applies fleet search, status, sort and paging inside the client boundary', async () => {
    const prisma = {
      fleet: { findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([[], 31]),
    };
    await new FleetsService(prisma as never, {} as never).list('client-a', {
      page: 2,
      pageSize: 25,
      search: 'EV-2',
      status: 'AVAILABLE',
      sortBy: 'vehicleNumber',
      sortDirection: 'asc',
    });
    expect(prisma.fleet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-a',
          deletedAt: null,
          status: 'AVAILABLE',
          OR: expect.any(Array),
        }),
        skip: 25,
        take: 25,
        orderBy: [{ vehicleNumber: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.fleet.count).toHaveBeenCalledWith({
      where: prisma.fleet.findMany.mock.calls[0][0].where,
    });
  });

  it('returns only open allocation summaries for rider lists and preserves KYC decoration', async () => {
    const prisma = {
      rider: { findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([[{ id: 'rider-1' }], 1]),
    };
    const kyc = {
      decorate: vi
        .fn()
        .mockResolvedValue([{ id: 'rider-1', kycStatus: 'VERIFIED' }]),
    };
    const result = await new RidersService(
      prisma as never,
      {} as never,
      kyc as never,
    ).list('client-a', {
      page: 1,
      pageSize: 10,
      status: 'ACTIVE',
      sortBy: 'name',
      sortDirection: 'asc',
    });
    expect(prisma.rider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-a', deletedAt: null, status: 'ACTIVE' },
        include: {
          allocations: expect.objectContaining({
            take: 1,
            where: {
              status: {
                in: [
                  'INSPECTION_PENDING',
                  'OTP_PENDING',
                  'ACTIVE',
                  'DEALLOCATION_INITIATED',
                ],
              },
            },
          }),
        },
      }),
    );
    expect(kyc.decorate).toHaveBeenCalledWith('client-a', [{ id: 'rider-1' }]);
    expect(result.items[0].kycStatus).toBe('VERIFIED');
  });

  it('scopes audit search, counts and resolved names to the authenticated client', async () => {
    const prisma = {
      auditLog: { findMany: vi.fn(), count: vi.fn() },
      $transaction: vi
        .fn()
        .mockResolvedValue([
          [
            {
              id: 1n,
              actorId: 'actor-1',
              entityType: 'FLEET',
              entityId: 'fleet-1',
            },
          ],
          1,
        ]),
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
    };
    const result = await new AuditService(prisma as never).list(
      'client-a',
      2,
      10,
      {
        search: 'Manager',
        action: 'UPDATE',
        entityType: 'FLEET',
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-19T23:59:59Z',
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
    );
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      clientId: 'client-a',
      action: { contains: 'UPDATE' },
      entityType: { contains: 'FLEET' },
      createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    expect(where.OR).toContainEqual({
      actor: {
        is: {
          clientId: 'client-a',
          name: { contains: 'Manager', mode: 'insensitive' },
        },
      },
    });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where });
    for (const model of [prisma.user, prisma.fleet, prisma.rider])
      expect(model.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clientId: 'client-a' }),
        }),
      );
    expect(result.items[0]).toMatchObject({
      actorName: 'Manager',
      entityName: 'EV001',
      entityId: 'fleet-1',
    });
  });

  it('rejects reversed audit date ranges before querying the database', async () => {
    const transaction = vi.fn();
    await expect(
      new AuditService({ $transaction: transaction } as never).list(
        'client-a',
        1,
        10,
        { from: '2026-10-20', to: '2026-10-01' },
      ),
    ).rejects.toThrow('Start date must not be after end date');
    expect(transaction).not.toHaveBeenCalled();
  });
});
