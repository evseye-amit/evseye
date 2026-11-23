import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationCatalogAdminService } from '../../src/notifications/notification-catalog-admin.service.js';
import {
  CreateCatalogCategoryDto,
  UpdateCatalogCategoryDto,
} from '../../src/notifications/notification-catalog-admin.dto.js';
const actor: any = { id: 'admin', roles: ['SUPER_ADMIN'] };
const revision = '2026-11-23T00:00:00.000Z';
const input = {
  name: ' Offers ',
  description: ' Offers description ',
  isActive: true,
  applications: ['RIDER'],
  expectedUpdatedAt: revision,
};
function fixture() {
  const before = {
    code: 'PG11_OFFERS',
    parentCode: 'PG11',
    name: 'Offers',
    updatedAt: new Date(revision),
    applications: [{ application: 'RIDER', allowed: true }],
  };
  const tx: any = {
    notificationParentGroup: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({
        code: 'PG11',
        isActive: true,
        updatedAt: new Date(revision),
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ code: 'PG11', isActive: false })),
    },
    notificationCategory: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => before),
      create: vi.fn(async ({ data }: any) => data),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ ...before, name: 'New name' })),
    },
    notificationApplicationCategory: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const service = new NotificationCatalogAdminService(tx, {
    transaction: (fn: any) => fn(tx),
  } as any);
  return { tx, service };
}
describe('platform notification catalog', () => {
  it('rejects client administrators and riders before reading or writing', async () => {
    const { service, tx } = fixture();
    for (const roles of [['CLIENT_ADMIN'], ['RIDER']]) {
      await expect(service.list({ ...actor, roles })).rejects.toThrow(
        'Platform administrator',
      );
      await expect(
        service.update({ ...actor, roles }, 'PG11_OFFERS', input),
      ).rejects.toThrow('Platform administrator');
      await expect(
        service.create(
          { ...actor, roles },
          { ...input, code: 'PG11_NEW', parentCode: 'PG11' },
        ),
      ).rejects.toThrow('Platform administrator');
      await expect(
        service.group({ ...actor, roles }, 'PG11', {
          isActive: false,
          expectedUpdatedAt: revision,
        }),
      ).rejects.toThrow('Platform administrator');
    }
    expect(tx.notificationCategory.updateMany).not.toHaveBeenCalled();
  });
  it('rejects stale category edits before changing mapping or audit', async () => {
    const { service, tx } = fixture();
    await expect(
      service.update(actor, 'PG11_OFFERS', {
        ...input,
        expectedUpdatedAt: '2026-11-22T00:00:00Z',
      }),
    ).rejects.toThrow('Reload');
    expect(tx.notificationApplicationCategory.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    tx.notificationCategory.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update(actor, 'PG11_OFFERS', input)).rejects.toThrow(
      'Reload',
    );
    expect(tx.notificationApplicationCategory.upsert).not.toHaveBeenCalled();
  });
  it('replaces all four mappings and audits before/after without changing classification', async () => {
    const { service, tx } = fixture();
    await service.update(actor, 'PG11_OFFERS', {
      ...input,
      applications: ['FLEET_MANAGER'],
    });
    expect(tx.notificationCategory.updateMany.mock.calls[0][0]).toMatchObject({
      where: { code: 'PG11_OFFERS', updatedAt: new Date(revision) },
      data: { name: 'Offers', description: 'Offers description' },
    });
    expect(
      tx.notificationCategory.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('parentCode');
    expect(
      tx.notificationCategory.updateMany.mock.calls[0][0].data.updatedAt.getTime(),
    ).toBeGreaterThan(new Date(revision).getTime());
    expect(tx.notificationApplicationCategory.upsert).toHaveBeenCalledTimes(4);
    expect(
      tx.notificationApplicationCategory.upsert.mock.calls[0][0].update.allowed,
    ).toBe(false);
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
      actorId: 'admin',
      action: 'NOTIFICATION_CATEGORY_UPDATED',
      previousData: { name: 'Offers' },
      newData: { name: 'New name' },
    });
  });
  it('allows only matching immutable classification on creation, defaulting to token delivery', async () => {
    const { service, tx } = fixture();
    await expect(
      service.create(actor, { ...input, parentCode: 'PG01', code: 'PG11_NEW' }),
    ).rejects.toThrow('parent');
    await expect(
      service.create(actor, { ...input, parentCode: 'PG11', code: 'PG11_NEW' }),
    ).rejects.toThrow('already exists');
    tx.notificationCategory.findUnique.mockResolvedValue(null);
    await service.create(actor, {
      ...input,
      parentCode: 'PG11',
      code: 'PG11_NEW',
      applications: [],
    });
    const data = tx.notificationCategory.create.mock.calls[0][0].data;
    expect(data.defaultDelivery).toBe('TOKEN');
    expect(data.defaultPriority).toBe('NORMAL');
    expect(data.applications.create).toHaveLength(4);
    expect(
      data.applications.create.every((a: any) => a.allowed === false),
    ).toBe(true);
  });
  it('rejects duplicate display names within the parent group', async () => {
    const { service, tx } = fixture();
    tx.notificationCategory.findFirst.mockResolvedValue({ code: 'PG11_OTHER' });
    await expect(service.update(actor, 'PG11_OFFERS', input)).rejects.toThrow(
      'name already exists',
    );
    expect(tx.notificationCategory.updateMany).not.toHaveBeenCalled();
    tx.notificationCategory.findUnique.mockResolvedValue(null);
    await expect(
      service.create(actor, { ...input, parentCode: 'PG11', code: 'PG11_NEW' }),
    ).rejects.toThrow('name already exists');
    expect(tx.notificationCategory.create).not.toHaveBeenCalled();
  });
  it('version-checks parent toggles without rewriting child settings', async () => {
    const { service, tx } = fixture();
    await expect(
      service.group(actor, 'PG11', {
        isActive: false,
        expectedUpdatedAt: '2000-01-01',
      }),
    ).rejects.toThrow('Reload');
    await service.group(actor, 'PG11', {
      isActive: false,
      expectedUpdatedAt: revision,
    });
    expect(tx.notificationCategory.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe(
      'NOTIFICATION_PARENT_GROUP_UPDATED',
    );
  });
  it('validates mapping values, duplicate apps, booleans and immutable fields', async () => {
    for (const patch of [
      { applications: ['GLOBAL'] },
      { applications: ['RIDER', 'RIDER'] },
      { isActive: 'true' },
      { name: '  ' },
      { expectedUpdatedAt: null },
      { parentCode: 'PG01' },
    ]) {
      const errors = await validate(
        plainToInstance(UpdateCatalogCategoryDto, { ...input, ...patch }),
        { whitelist: true, forbidNonWhitelisted: true },
      );
      expect(errors.length).toBeGreaterThan(0);
    }
    const { expectedUpdatedAt: _expectedUpdatedAt, ...fields } = input;
    expect(
      await validate(
        plainToInstance(CreateCatalogCategoryDto, {
          ...fields,
          parentCode: 'PG11',
          code: 'PG11_CUSTOM',
        }),
      ),
    ).toHaveLength(0);
  });
});
