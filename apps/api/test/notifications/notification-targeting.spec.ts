import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { targetSnapshot } from '../../src/notifications/notification-targeting.js';
const admin: AuthUser = {
  id: 'admin',
  clientId: 'client',
  roles: ['CLIENT_ADMIN'],
};
const manager: AuthUser = {
  id: 'manager',
  clientId: 'client',
  roles: ['FLEET_MANAGER'],
};
function setup() {
  const tx: any = {
    userHub: { findMany: vi.fn(async () => [{ hubId: 'h1' }]) },
    notificationMessage: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => ({ id: 'message' })),
      create: vi.fn(async ({ data }) => data),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
    },
    notificationCategory: { findFirst: vi.fn(async () => null) },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ users: 1n, devices: 0n, pushUsers: 0n }]),
  };
  tx.$transaction = async (fn: any) => fn(tx);
  return {
    tx,
    service: new NotificationService(
      tx,
      new ConfigService({ PUSH_TTL_SECONDS: 86400 }),
      { configured: false, send: async () => [] },
    ),
  };
}
describe('notification targeting service', () => {
  it('schedules immutable recipients and starts TTL at release; replays after release', async () => {
    const { service, tx } = setup();
    const scheduledFor = new Date(Date.now() + 3600000).toISOString();
    const input = {
      audience: 'ALL_RIDERS' as const,
      title: 'Notice',
      body: 'Message',
      scheduledFor,
    };
    const result = await service.send('client', admin, input, 'scheduled-key');
    expect(result).toMatchObject({
      status: 'SCHEDULED',
      scheduledFor: new Date(scheduledFor),
      pushExpiresAt: new Date(new Date(scheduledFor).getTime() + 86400000),
    });
    expect(tx.$executeRaw.mock.calls[0][0].values).toContainEqual(
      new Date(scheduledFor),
    );
    tx.notificationMessage.findUnique.mockResolvedValue(result);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(scheduledFor).getTime() + 1000);
    try {
      expect(
        await service.send('client', admin, input, 'scheduled-key'),
      ).toEqual(result);
      await expect(
        service.send(
          'client',
          admin,
          {
            ...input,
            scheduledFor: new Date(Date.now() + 3600000).toISOString(),
          },
          'scheduled-key',
        ),
      ).rejects.toThrow('different notification');
    } finally {
      clock.mockRestore();
    }
  });
  it('rejects schedules outside the window or after visibility expiry', async () => {
    const { service, tx } = setup();
    const base = {
      audience: 'ALL_RIDERS' as const,
      title: 'Notice',
      body: 'Message',
    };
    for (const delta of [-1000, 30000, 91 * 86400000]) {
      await expect(
        service.send(
          'client',
          admin,
          { ...base, scheduledFor: new Date(Date.now() + delta).toISOString() },
          'invalid-schedule',
        ),
      ).rejects.toThrow('one minute');
    }
    await expect(
      service.send(
        'client',
        admin,
        {
          ...base,
          scheduledFor: new Date(Date.now() + 3600000).toISOString(),
          visibilityExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
        'invalid-expiry',
      ),
    ).rejects.toThrow('after the scheduled');
    expect(tx.notificationMessage.create).not.toHaveBeenCalled();
  });
  it('offers sender catalogs across applications while restricting manager hub/fleet choices', async () => {
    const { service, tx } = setup();
    tx.notificationParentGroup = {
      findMany: vi.fn(async () => [
        { code: 'PG01', categories: [{ code: 'PG01_ANNOUNCEMENTS' }] },
        { code: 'PG02', categories: [] },
      ]),
    };
    tx.hub = { findMany: vi.fn(async () => []) };
    tx.vehicleType = { findMany: vi.fn(async () => []) };
    tx.oem = { findMany: vi.fn(async () => []) };
    expect(await service.composerOptions('client', manager)).toMatchObject({
      hubScoped: true,
      groups: [{ code: 'PG01' }],
    });
    expect(tx.hub.findMany.mock.calls[0][0].where).toEqual({
      clientId: 'client',
      deletedAt: null,
      id: { in: ['h1'] },
    });
    expect(
      tx.vehicleType.findMany.mock.calls[0][0].where.fleets.some,
    ).toMatchObject({
      clientId: 'client',
      deletedAt: null,
      OR: [
        { currentHubId: { in: ['h1'] } },
        { currentHubId: null, homeHubId: { in: ['h1'] } },
      ],
    });
    await expect(service.composerOptions('other', manager)).rejects.toThrow(
      'mismatch',
    );
    await expect(
      service.composerOptions('client', { ...manager, roles: ['RIDER'] }),
    ).rejects.toThrow('Only client admins');
    tx.userHub.findMany.mockResolvedValue([]);
    await expect(service.composerOptions('client', manager)).rejects.toThrow(
      'No assigned hubs',
    );
  });
  it('stores normalized immutable operational rules with the recipient snapshot', async () => {
    const { service, tx } = setup();
    const result = await service.send(
      'client',
      admin,
      {
        audience: 'ALL_RIDERS',
        title: 'Hub notice',
        body: 'Message',
        hubIds: ['h2', 'h1'],
        cities: [' DELHI '],
        application: 'RIDER',
      },
      'stable-key-1',
    );
    expect(result).toMatchObject({
      targetRoles: ['RIDER'],
      targetHubIds: ['h1', 'h2'],
      targetCities: ['delhi'],
      application: 'RIDER',
      visibilityPolicy: 'OPERATIONAL',
    });
    expect(tx.$executeRaw.mock.calls[0][0].sql).toContain(
      'INSERT INTO "UserNotification"',
    );
  });
  it('does not let a sender turn a scoped operational message into permanent general access', async () => {
    const { service, tx } = setup();
    await expect(
      service.send(
        'client',
        admin,
        {
          audience: 'ALL_RIDERS',
          title: 'Notice',
          body: 'Message',
          hubIds: ['h1'],
          visibilityPolicy: 'GENERAL',
        },
        'stable-key-2',
      ),
    ).rejects.toThrow('OPERATIONAL');
    expect(tx.notificationMessage.create).not.toHaveBeenCalled();
  });
  it('persists categorized rider events as personal history and deduplicates retries', async () => {
    const { service, tx } = setup();
    tx.notificationCategory.findFirst.mockResolvedValue({
      code: 'PG03_VEHICLE_HANDOVER',
    });
    const content = {
      title: 'Handover complete',
      body: 'Your allocation is active.',
      categoryCode: 'PG03_VEHICLE_HANDOVER',
      application: 'RIDER' as const,
      data: {
        schemaVersion: '1',
        action: 'ALLOCATION_DETAILS',
        allocationId: 'allocation',
      },
    };
    const first = await service.sendToUsers(
      'client',
      ['rider'],
      content,
      'allocation:allocation:ACTIVATED',
      'ALLOCATION',
    );
    expect(first).toMatchObject({
      visibilityPolicy: 'PERSONAL',
      categoryCode: content.categoryCode,
      application: 'RIDER',
      source: 'ALLOCATION',
    });
    tx.notificationMessage.findUnique.mockResolvedValue(first);
    expect(
      await service.sendToUsers(
        'client',
        ['rider'],
        content,
        'allocation:allocation:ACTIVATED',
        'ALLOCATION',
      ),
    ).toEqual(first);
    expect(tx.notificationMessage.create).toHaveBeenCalledTimes(1);
  });
  it('preserves personal system events independently of current group membership', async () => {
    const { service } = setup();
    expect(
      await service.sendToUsers(
        'client',
        ['rider'],
        { title: 'Invoice', body: 'Ready' },
        'invoice:123',
      ),
    ).toMatchObject({
      visibilityPolicy: 'PERSONAL',
      targetHubIds: [],
      targetRoles: [],
      audience: 'USER_IDS',
    });
  });
  it('forces fleet-manager audiences into assigned hubs inside the transaction', async () => {
    const { service } = setup();
    expect(
      await service.send(
        'client',
        manager,
        { audience: 'ALL_RIDERS', title: 'Notice', body: 'Message' },
        'stable-key-3',
      ),
    ).toMatchObject({ targetHubIds: ['h1'] });
    await expect(
      service.send(
        'client',
        manager,
        {
          audience: 'ALL_RIDERS',
          title: 'Notice',
          body: 'Message',
          hubIds: ['h2'],
        },
        'stable-key-4',
      ),
    ).rejects.toThrow('assigned hubs');
  });
  it('rejects unassigned managers, mismatched tenants, blank cities and unsupported categories', async () => {
    const { service, tx } = setup();
    tx.userHub.findMany.mockResolvedValue([]);
    await expect(
      service.preview('client', manager, { audience: 'ALL_USERS' }),
    ).rejects.toThrow('assigned hubs');
    await expect(
      service.preview('other', admin, { audience: 'ALL_USERS' }),
    ).rejects.toThrow('mismatch');
    await expect(
      service.preview('client', admin, {
        audience: 'ALL_USERS',
        cities: [' '],
      }),
    ).rejects.toThrow('blank');
    await expect(
      service.send(
        'client',
        admin,
        {
          audience: 'ALL_USERS',
          title: 'Notice',
          body: 'Message',
          categoryCode: 'PG01_GENERAL_NOTIFICATIONS',
          application: 'RIDER',
        },
        'stable-key-5',
      ),
    ).rejects.toThrow('unavailable');
  });
  it('includes targeting in the idempotency digest', async () => {
    const { service, tx } = setup();
    const body = {
      audience: 'ALL_RIDERS' as const,
      title: 'Notice',
      body: 'Message',
      hubIds: ['h1'],
    };
    const first = await service.send('client', admin, body, 'same-key-1');
    tx.notificationMessage.findUnique.mockResolvedValue(first);
    await expect(
      service.send('client', admin, { ...body, hubIds: ['h2'] }, 'same-key-1'),
    ).rejects.toThrow('different notification');
  });
  it('audits withdrawal and restricts managers to their own broadcasts', async () => {
    const { service, tx } = setup();
    expect(await service.withdraw('client', manager, 'message')).toEqual({
      withdrawn: true,
    });
    expect(tx.notificationMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'message', clientId: 'client', senderId: 'manager' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'NOTIFICATION_WITHDRAWN',
        actorId: 'manager',
      }),
    });
  });
  it('normalizes employee and Team Leader role rules explicitly', () => {
    expect(
      targetSnapshot({ audience: 'ALL_EMPLOYEES' }).targetRoles,
    ).not.toContain('SUPER_ADMIN');
    expect(
      targetSnapshot({ audience: 'ALL_TEAM_LEADERS' }).targetRoles,
    ).toEqual(['TEAM_LEAD']);
  });
});
