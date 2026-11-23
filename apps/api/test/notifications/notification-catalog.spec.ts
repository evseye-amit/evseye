import { describe, expect, it, vi } from 'vitest';
import { NotificationCatalogService } from '../../src/notifications/notification-catalog.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
// Seed is deliberately shared with the CLI, avoiding a separate test-only master.
import {
  notificationCatalog,
  seedNotifications,
} from '../../prisma/seed-notifications.mjs';

type Category = {
  code: string;
  name: string;
  parentCode: string;
  applications: string[];
  defaultDelivery: string;
};
const categories = notificationCatalog.categories as Category[];
describe('notification catalog master', () => {
  it('contains every approved category exactly once with explicit application mappings', () => {
    expect(notificationCatalog.groups).toHaveLength(12);
    expect(categories).toHaveLength(120);
    expect(new Set(categories.map((c) => c.code)).size).toBe(120);
    expect(new Set(categories.map((c) => c.name)).size).toBe(120);
    for (const c of categories) {
      expect(c.code).toMatch(/^PG\d{2}_[A-Z0-9_]+$/);
      expect(
        notificationCatalog.groups.some(
          (g: { code: string }) => g.code === c.parentCode,
        ),
      ).toBe(true);
      expect(
        c.applications.every((app) =>
          ['RIDER', 'FLEET_MANAGER', 'TEAM_LEADER', 'ADMIN'].includes(app),
        ),
      ).toBe(true);
    }
    expect(
      categories.find((c) => c.name === 'Repair Assignment')?.applications,
    ).not.toContain('RIDER');
    expect(
      categories
        .filter((c) => c.parentCode === 'PG07')
        .every((c) => !c.applications.includes('TEAM_LEADER')),
    ).toBe(true);
    expect(
      categories.find((c) => c.name === 'Referral Rewards')?.defaultDelivery,
    ).toBe('TOKEN');
  });

  it('seed reruns fill missing rows but preserve administrator edits', async () => {
    const maps = [new Map(), new Map(), new Map()];
    const model = (map: Map<string, any>) => ({
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = JSON.stringify(where);
        const row = map.get(key);
        map.set(key, row ? { ...row, ...update } : { ...create });
      }),
    });
    const tx = {
      notificationParentGroup: model(maps[0]!),
      notificationCategory: model(maps[1]!),
      notificationApplicationCategory: model(maps[2]!),
    };
    const db = { $transaction: (fn: (tx: unknown) => unknown) => fn(tx) };
    await seedNotifications(
      db as unknown as Pick<PrismaService, '$transaction'>,
    );
    const first = maps[1]!.values().next().value!;
    first.name = 'Admin edited title';
    first.isActive = false;
    const mapping = maps[2]!.values().next().value!;
    mapping.allowed = false;
    await seedNotifications(
      db as unknown as Pick<PrismaService, '$transaction'>,
    );
    expect(maps.map((m) => m.size)).toEqual([12, 120, 480]);
    expect(maps[1]!.values().next().value).toMatchObject({
      name: 'Admin edited title',
      isActive: false,
    });
    expect(maps[2]!.values().next().value.allowed).toBe(false);
  });

  it('does not allow a rider to enumerate staff application categories', async () => {
    const findMany = vi.fn();
    const service = new NotificationCatalogService({
      notificationParentGroup: { findMany },
    } as unknown as PrismaService);
    await expect(
      service.applicable(
        { id: 'rider', clientId: 'client', roles: ['RIDER'] },
        'FLEET_MANAGER',
      ),
    ).rejects.toThrow('account role');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns only applicable active categories and removes empty groups', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { code: 'PG01', categories: [{ code: 'PG01_GENERAL_NOTIFICATIONS' }] },
      { code: 'PG07', categories: [] },
    ]);
    const service = new NotificationCatalogService({
      notificationParentGroup: { findMany },
    } as unknown as PrismaService);
    const result = await service.applicable(
      { id: 'lead', clientId: 'client', roles: ['TEAM_LEAD'] },
      'TEAM_LEADER',
    );
    expect(result.groups).toHaveLength(1);
    expect(result.catalogRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { isActive: true },
      select: {
        categories: {
          where: {
            isActive: true,
            applications: {
              some: { application: 'TEAM_LEADER', allowed: true },
            },
          },
        },
      },
    });
  });
});
