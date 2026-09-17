import { ConflictException, NotFoundException } from '@nestjs/common';
import { ImportEntityType, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ClientUsersService } from './client-users.service.js';

describe('ClientUsersService deletion', () => {
  it('soft deletes a Fleet Manager in the client and clears hub assignments', async () => {
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'manager-1' }), update: vi.fn().mockResolvedValue({}) },
      userHub: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new ClientUsersService(prisma as never);
    await expect(service.deleteFleetManager('client-1', 'manager-1')).resolves.toEqual({ deleted: true });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'manager-1', clientId: 'client-1', role: UserRole.FLEET_MANAGER, deletedAt: null },
      select: { id: true },
    });
    expect(prisma.userHub.deleteMany).toHaveBeenCalledWith({ where: { userId: 'manager-1', clientId: 'client-1' } });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'manager-1' }, data: { isActive: false, deletedAt: expect.any(Date) } });
  });

  it('does not deactivate a Fleet Manager outside the client', async () => {
    const prisma = { user: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() }, $transaction: vi.fn() };
    const service = new ClientUsersService(prisma as never);
    await expect(service.deleteFleetManager('client-1', 'other-manager')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ClientUsersService Fleet Manager status', () => {
  it('lists active and inactive managers that have not been deleted', async () => {
    const prisma = { user: { findMany: vi.fn().mockResolvedValue([]) } };
    await new ClientUsersService(prisma as never).listFleetManagers('client-1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-1', role: UserRole.FLEET_MANAGER, deletedAt: null },
    }));
  });

  it('updates status while preserving selected and primary hubs', async () => {
    const prisma = {
      hub: { count: vi.fn().mockResolvedValue(2) },
      user: { findFirst: vi.fn().mockResolvedValueOnce({ id: 'manager-1' }).mockResolvedValueOnce(null), update: vi.fn().mockResolvedValue({ id: 'manager-1', isActive: false }) },
      userHub: { deleteMany: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const service = new ClientUsersService(prisma as never);
    await service.updateFleetManager('client-1', 'manager-1', {
      name: 'Manager', mobile: '+919999999999', hubIds: ['hub-1', 'hub-2'], primaryHubId: 'hub-2', isActive: false,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'manager-1' }, data: { name: 'Manager', mobile: '+919999999999', isActive: false } });
    expect(prisma.userHub.createMany).toHaveBeenCalledWith({ data: [
      { clientId: 'client-1', userId: 'manager-1', hubId: 'hub-1', isPrimary: false },
      { clientId: 'client-1', userId: 'manager-1', hubId: 'hub-2', isPrimary: true },
    ] });
  });
});

describe('ClientUsersService import history', () => {
  it('loads saved jobs for only the authenticated client and selected entity', async () => {
    const jobs = [{ id: 'job-1', originalFilename: 'managers.csv' }];
    const prisma = { importJob: { findMany: vi.fn().mockResolvedValue(jobs) } };
    const service = new ClientUsersService(prisma as never);
    await expect(service.listImportHistory('client-1', ImportEntityType.FLEET_MANAGER)).resolves.toEqual(jobs);
    expect(prisma.importJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { clientId: 'client-1', entityType: ImportEntityType.FLEET_MANAGER },
      orderBy: { createdAt: 'desc' },
    }));
  });
});

describe('ClientUsersService Team Leader reassignment', () => {
  it('transfers riders before deactivating the source account', async () => {
    const calls: string[] = [];
    const prisma = {
      teamLeaderProfile: { findFirst: vi.fn().mockResolvedValueOnce({ userId: 'source-user' }).mockResolvedValueOnce({ id: 'target-profile' }) },
      teamLeaderRider: {
        findMany: vi.fn().mockResolvedValue([{ riderId: 'rider-1', isPrimary: true }]),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockImplementation(async () => { calls.push('remove-primary-or-source'); return { count: 1 }; }),
        upsert: vi.fn().mockImplementation(async () => { calls.push('transfer'); return {}; }),
      },
      user: { updateMany: vi.fn().mockImplementation(async () => { calls.push('deactivate'); return { count: 1 }; }) },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    const result = await new ClientUsersService(prisma as never).reassignTeamLeader('client-1', 'source-profile', 'target-profile');
    expect(result).toEqual({ reassigned: 1, deactivated: true });
    expect(prisma.teamLeaderRider.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ teamLeaderId: 'target-profile', riderId: 'rider-1', isPrimary: true }),
    }));
    expect(calls.indexOf('transfer')).toBeLessThan(calls.indexOf('deactivate'));
  });

  it('refuses to deactivate a Team Leader with riders and no recipient', async () => {
    const prisma = {
      teamLeaderProfile: { findFirst: vi.fn().mockResolvedValue({ userId: 'source-user' }) },
      teamLeaderRider: { findMany: vi.fn().mockResolvedValue([{ riderId: 'rider-1', isPrimary: true }]) },
      user: { updateMany: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    await expect(new ClientUsersService(prisma as never).reassignTeamLeader('client-1', 'source-profile')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an inactive or out-of-client recipient before changing assignments', async () => {
    const prisma = {
      teamLeaderProfile: { findFirst: vi.fn().mockResolvedValueOnce({ userId: 'source-user' }).mockResolvedValueOnce(null) },
      teamLeaderRider: { findMany: vi.fn().mockResolvedValue([{ riderId: 'rider-1', isPrimary: true }]), updateMany: vi.fn(), upsert: vi.fn() },
      user: { updateMany: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
    };
    await expect(new ClientUsersService(prisma as never).reassignTeamLeader('client-1', 'source-profile', 'inactive-profile')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.teamLeaderRider.upsert).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
