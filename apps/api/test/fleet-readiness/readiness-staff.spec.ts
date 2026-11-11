import { describe, expect, it, vi } from 'vitest';
import { FleetReadinessService } from '../../src/fleet-readiness/readiness.service.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
const admin: AuthUser = {
  id: 'admin-1',
  clientId: 'client-a',
  roles: ['CLIENT_ADMIN'],
};

function fixture(mode = 'PREPARATION_QC') {
  const db = {
    client: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ fleetOperatingMode: mode }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'staff-1',
        ...data,
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    hub: { findMany: vi.fn().mockResolvedValue([]) },
    fleetReadinessStaff: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn() },
  };
  return { db, service: new FleetReadinessService(db as never, {} as never) };
}

describe('Dedicated Advisor and QC staff', () => {
  it.each(['ADVISOR', 'QC_MANAGER'])(
    'creates %s within the client and records the existing audit event',
    async (role) => {
      const { db, service } = fixture();
      await expect(
        service.createStaff('client-a', admin, {
          name: 'Staff member',
          mobile: '+919000000001',
          role,
        }),
      ).resolves.toMatchObject({ role, clientId: 'client-a' });
      expect(db.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Staff member',
            mobile: '+919000000001',
            role,
            clientId: 'client-a',
          },
        }),
      );
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-a',
          actorId: 'admin-1',
          action: 'READINESS_STAFF_CREATED',
        }),
      });
    },
  );

  it.each(['ADVISOR', 'QC_MANAGER'])(
    'blocks dedicated %s creation in Simple mode without changing any users',
    async (role) => {
      const { db, service } = fixture('SIMPLE');
      await expect(
        service.createStaff('client-a', admin, {
          name: 'Staff member',
          mobile: '+919000000001',
          role,
        }),
      ).rejects.toThrow('unavailable in Simple mode');
      expect(db.user.create).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('retains duplicate-mobile and admin-only checks', async () => {
    const { db, service } = fixture();
    db.user.findUnique.mockResolvedValue({ id: 'existing' } as never);
    await expect(
      service.createStaff('client-a', admin, {
        name: 'Staff',
        mobile: '+919000000001',
        role: 'ADVISOR',
      }),
    ).rejects.toThrow('already belongs to a user');
    await expect(
      service.createStaff(
        'client-a',
        { ...admin, roles: ['FLEET_MANAGER'] },
        { name: 'Staff', mobile: '+919000000001', role: 'ADVISOR' },
      ),
    ).rejects.toThrow('Client Admin permission');
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('keeps Advisors, existing RFD staff and QC Managers in the scoped staff directory', async () => {
    const { db, service } = fixture();
    await service.staff('client-a', admin);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client-a',
          deletedAt: null,
          role: {
            in: expect.arrayContaining([
              'ADVISOR',
              'QC_MANAGER',
              'CLIENT_ADMIN',
              'FLEET_MANAGER',
            ]),
          },
        },
      }),
    );
  });

  it.each(['ADVISOR', 'QC_MANAGER'])(
    'prevents granting dedicated %s permissions in Simple mode',
    async (role) => {
      const tx = {
        $queryRaw: vi.fn(),
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'staff-1', role }) },
        client: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
        },
        fleetReadinessStaff: { deleteMany: vi.fn(), createMany: vi.fn() },
      };
      const service = new FleetReadinessService(
        {
          $transaction: vi.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
        } as never,
        {} as never,
      );
      await expect(
        service.saveStaff('client-a', admin, 'staff-1', { assignments: [] }),
      ).rejects.toThrow('unavailable in Simple mode');
      expect(tx.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'staff-1',
            clientId: 'client-a',
          }),
        }),
      );
      expect(tx.fleetReadinessStaff.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['CLIENT_ADMIN', 'FLEET_MANAGER'])(
    'preserves existing operator permissions for %s in Simple mode',
    async (role) => {
      const tx = {
        $queryRaw: vi.fn(),
        user: {
          findFirst: vi.fn().mockResolvedValue({ id: 'operator-1', role }),
        },
        client: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ fleetOperatingMode: 'SIMPLE' }),
        },
        fleetReadinessStaff: { deleteMany: vi.fn(), createMany: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      const service = new FleetReadinessService(
        {
          $transaction: vi.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
        } as never,
        {} as never,
      );
      await expect(
        service.saveStaff('client-a', admin, 'operator-1', { assignments: [] }),
      ).resolves.toMatchObject({ userId: 'operator-1' });
      expect(tx.client.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(tx.fleetReadinessStaff.deleteMany).toHaveBeenCalledWith({
        where: { clientId: 'client-a', userId: 'operator-1' },
      });
    },
  );

  it('still requires an explicit hub capability for Advisors', async () => {
    const { db, service } = fixture();
    const tx = {
      ...db,
      hub: { ...db.hub, findFirst: vi.fn().mockResolvedValue({ id: 'hub-1' }) },
    };
    await expect(
      service.access(
        tx as never,
        'client-a',
        { ...admin, roles: ['ADVISOR'] },
        'hub-1',
        'canPrepare',
      ),
    ).rejects.toThrow('requires readiness permission');
    expect(db.fleetReadinessStaff.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-a', userId: 'admin-1', canPrepare: true },
    });
  });
});
