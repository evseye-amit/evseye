import { describe, it, expect, vi, beforeEach } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationPreferencesService } from '../../src/notifications/notification-preferences.service.js';
import { UpdateNotificationPreferencesDto } from '../../src/notifications/notification-preferences.controller.js';

describe('notification preference authorization and validation', () => {
  let db: any, service: NotificationPreferencesService;
  const actor: any = { id: 'user', clientId: 'tenant', roles: ['RIDER'] };
  beforeEach(() => {
    db = {
      user: { findFirst: vi.fn().mockResolvedValue({ role: 'RIDER' }) },
      notificationConsent: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      notificationPreference: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      notificationApplicationCategory: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            ['PG11_OFFERS', 'PG01_APP_UPDATES', 'PG06_INVOICE'].map(
              (categoryCode) => ({ categoryCode }),
            ),
          ),
      },
      pushDevice: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    db.$transaction = (fn: any) => fn(db);
    service = new NotificationPreferencesService(db);
  });
  it('defaults marketing to off while returning effective and requested values', async () => {
    const state = await service.get('tenant', actor, 'RIDER');
    expect(state.marketingEnabled).toBe(false);
    expect(state.categories[0]).toMatchObject({
      pushEnabled: true,
      effectivePushEnabled: false,
      mandatory: false,
    });
    expect(state.categories[2]).toMatchObject({
      effectivePushEnabled: true,
      mandatory: true,
    });
    expect(db.notificationPreference.findMany).toHaveBeenCalledWith({
      where: { clientId: 'tenant', userId: 'user', application: 'RIDER' },
    });
  });
  it('uses current database role and rejects another tenant', async () => {
    await expect(service.get('other', actor, 'RIDER')).rejects.toThrow(
      'Client mismatch',
    );
    db.user.findFirst.mockResolvedValue({ role: 'FLEET_MANAGER' });
    await expect(service.get('tenant', actor, 'RIDER')).rejects.toThrow(
      'account role',
    );
    db.user.findFirst.mockResolvedValue(null);
    await expect(service.get('tenant', actor, 'RIDER')).rejects.toThrow(
      'account role',
    );
  });
  it.each([
    [{ categoryCode: 'PG06_INVOICE', pushEnabled: false }],
    [{ categoryCode: 'PG99_UNKNOWN', pushEnabled: false }],
    [
      { categoryCode: 'PG11_OFFERS', pushEnabled: true },
      { categoryCode: 'PG11_OFFERS', pushEnabled: false },
    ],
  ])(
    'rejects invalid preferences atomically before writes',
    async (...categories) => {
      await expect(
        service.update('tenant', actor, {
          application: 'RIDER',
          marketingEnabled: true,
          categories: categories as any,
        }),
      ).rejects.toThrow();
      expect(db.notificationConsent.upsert).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    },
  );
  it('upserts only supplied values under authenticated identity and audits consent changes', async () => {
    await service.update('tenant', actor, {
      application: 'RIDER',
      marketingEnabled: false,
      categories: [{ categoryCode: 'PG01_APP_UPDATES', pushEnabled: false }],
    });
    expect(db.notificationConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          clientId: 'tenant',
          userId: 'user',
          application: 'RIDER',
          marketingEnabled: false,
        },
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'user',
          action: 'NOTIFICATION_PREFERENCES_UPDATED',
        }),
      }),
    );
  });
  it('validates nested DTOs and rejects null/string consent', async () => {
    for (const input of [
      { marketingEnabled: null },
      { marketingEnabled: 'true' },
      { categories: [{ categoryCode: 'PG11_OFFERS', pushEnabled: 'false' }] },
      { categories: null },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(UpdateNotificationPreferencesDto, {
              application: 'RIDER',
              ...input,
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await validate(
        plainToInstance(UpdateNotificationPreferencesDto, {
          application: 'RIDER',
          marketingEnabled: false,
        }),
      ),
    ).toHaveLength(0);
  });
});
