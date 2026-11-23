import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../src/notifications/notification.service.js';

const admin: AuthUser = {
  id: 'admin',
  clientId: 'client',
  roles: ['CLIENT_ADMIN'],
};
const input = {
  deviceId: 'device',
  application: 'RIDER',
  categoryCode: 'PG01_GENERAL_NOTIFICATIONS',
  title: 'Hello',
  body: 'Test body',
};
function setup() {
  let stored: any = null;
  const tx: any = {
    notificationMessage: {
      findUnique: vi.fn(async () => stored),
      create: vi.fn(async ({ data }) => (stored = data)),
    },
    pushDevice: {
      findFirst: vi.fn(async () => ({
        id: 'device',
        userId: 'rider',
        version: 4,
        session: { userId: 'rider' },
      })),
      findMany: vi.fn(async () => []),
    },
    userNotification: {
      findFirst: vi.fn(async () => ({ userId: 'rider' })),
      findFirstOrThrow: vi.fn(async () => ({ id: 'recipient' })),
      update: vi.fn(),
    },
    pushDelivery: { create: vi.fn() },
    notificationCategory: {
      findFirst: vi.fn(async () => ({ code: input.categoryCode })),
    },
    auditLog: { create: vi.fn() },
    $queryRaw: vi.fn(async () => [{ users: 1n, devices: 2n, pushUsers: 1n }]),
    $executeRaw: vi.fn(async () => 1),
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
describe('administrator test notifications', () => {
  it('queues exactly the chosen device and prevents normal device expansion', async () => {
    const { tx, service } = setup();
    const result = await service.testSend(
      'client',
      admin,
      input,
      'test-key-123',
    );
    expect(result).toMatchObject({
      source: 'TEST',
      senderId: 'admin',
      totalUsers: 1,
      title: '[Test] Hello',
      application: 'RIDER',
      categoryCode: input.categoryCode,
    });
    expect(tx.pushDevice.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'device',
      clientId: 'client',
      isActive: true,
      appCode: 'RIDER_APP',
    });
    expect(tx.pushDelivery.create).toHaveBeenCalledWith({
      data: {
        messageId: result.id,
        userNotificationId: 'recipient',
        deviceId: 'device',
        deviceVersion: 4,
      },
    });
    expect(tx.userNotification.update).toHaveBeenCalledWith({
      where: { id: 'recipient' },
      data: { expandedAt: expect.any(Date), noActiveDevice: false },
    });
  });
  it('replays without another delivery even after registration disappears; rejects changed devices/content', async () => {
    const { tx, service } = setup();
    const first = await service.testSend(
      'client',
      admin,
      input,
      'test-key-123',
    );
    tx.pushDevice.findFirst.mockResolvedValue(null);
    expect(
      await service.testSend('client', admin, input, 'test-key-123'),
    ).toEqual(first);
    expect(tx.pushDelivery.create).toHaveBeenCalledTimes(1);
    for (const patch of [{ deviceId: 'other' }, { body: 'Changed' }])
      await expect(
        service.testSend(
          'client',
          admin,
          { ...input, ...patch },
          'test-key-123',
        ),
      ).rejects.toThrow('different notification');
  });
  it('rejects non-admins and cross-tenant actors before device lookup', async () => {
    const { tx, service } = setup();
    for (const actor of [
      { ...admin, roles: ['FLEET_MANAGER' as const] },
      { ...admin, clientId: 'other' },
    ]) {
      await expect(
        service.testSend('client', actor, input, 'test-key-123'),
      ).rejects.toThrow('administrators');
      await expect(
        service.testDevices('client', actor, {
          phone: '9876543210',
          application: 'RIDER',
        }),
      ).rejects.toThrow('administrators');
    }
    expect(tx.pushDevice.findFirst).not.toHaveBeenCalled();
    expect(tx.pushDevice.findMany).not.toHaveBeenCalled();
  });
  it('rejects stale or session-mismatched devices and missing keys', async () => {
    const { tx, service } = setup();
    await expect(
      service.testSend('client', admin, input, undefined as never),
    ).rejects.toThrow('Idempotency-Key');
    for (const device of [
      null,
      { id: 'device', userId: 'rider', session: { userId: 'other' } },
    ]) {
      tx.pushDevice.findFirst.mockResolvedValue(device);
      await expect(
        service.testSend('client', admin, input, 'test-key-123'),
      ).rejects.toThrow('not found');
    }
    expect(tx.notificationMessage.create).not.toHaveBeenCalled();
  });
  it('looks up only matching active tenant/application registrations and never selects tokens', async () => {
    const { tx, service } = setup();
    await service.testDevices('client', admin, {
      phone: '9876543210',
      application: 'RIDER',
    });
    const query = tx.pushDevice.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      clientId: 'client',
      appCode: 'RIDER_APP',
      isActive: true,
      user: {
        clientId: 'client',
        isActive: true,
        deletedAt: null,
        mobile: { in: expect.arrayContaining(['9876543210']) },
      },
      session: { revokedAt: null },
    });
    expect(query.select).toEqual({
      id: true,
      platform: true,
      appCode: true,
      lastRegisteredAt: true,
      user: { select: { name: true } },
    });
    await expect(
      service.testDevices('client', admin, {
        phone: 'invalid',
        application: 'RIDER',
      }),
    ).rejects.toThrow();
  });
  it('does not bypass disabled catalog validation', async () => {
    const { tx, service } = setup();
    tx.notificationCategory.findFirst.mockResolvedValue(null);
    await expect(
      service.testSend('client', admin, input, 'test-key-123'),
    ).rejects.toThrow('unavailable');
    expect(tx.pushDelivery.create).not.toHaveBeenCalled();
  });
});
