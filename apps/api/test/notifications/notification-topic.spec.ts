import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NotificationTopicService } from '../../src/notifications/notification-topic.service.js';
import { NotificationTopicWorker } from '../../src/notifications/notification-topic.worker.js';
import {
  topicName,
  audienceTopicKeys,
} from '../../src/notifications/notification-topic.helpers.js';

describe('topic desired-state planner', () => {
  let tx: any,
    service: NotificationTopicService,
    d: any,
    subscriptions: any[],
    topics: any[],
    consent: boolean,
    disabled: string[];
  beforeEach(() => {
    subscriptions = [];
    topics = [];
    consent = false;
    disabled = [];
    d = {
      id: 'device',
      clientId: 'tenant',
      userId: 'user',
      sessionId: 'session',
      version: 1,
      token: 'token',
      tokenHash: 'hash',
      isActive: true,
      appCode: 'RIDER_APP',
      platform: 'ANDROID',
      user: {
        role: 'RIDER',
        isActive: true,
        client: { isActive: true, status: 'ACTIVE' },
      },
      session: { userId: 'user', expiresAt: new Date(Date.now() + 60000) },
      notificationAppBinding: {
        id: 'binding',
        clientId: 'tenant',
        environment: 'test',
        appCode: 'RIDER_APP',
        platform: 'ANDROID',
        isActive: true,
        firebaseConfiguration: { isActive: true },
      },
    };
    tx = {
      $queryRaw: vi.fn(async (sql: any) =>
        (sql.text ?? sql.join('')).includes('pg_try_advisory')
          ? [{ locked: true }]
          : [
              {
                hubId: 'hub',
                city: ' Delhi ',
                vehicleTypeId: 'type',
                oemId: 'oem',
              },
            ],
      ),
      pushDevice: {
        findUnique: vi.fn(async () => d),
        update: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(async () => d),
      },
      notificationApplicationCategory: {
        findMany: vi.fn(async () => [
          { categoryCode: 'PG01_ANNOUNCEMENTS' },
          { categoryCode: 'PG11_OFFERS' },
        ]),
      },
      notificationPreference: {
        findMany: vi.fn(async () =>
          disabled.map((categoryCode) => ({ categoryCode })),
        ),
      },
      notificationConsent: {
        findUnique: vi.fn(async () => ({ marketingEnabled: consent })),
      },
      notificationTopic: {
        upsert: vi.fn(async ({ create }: any) => {
          let t = topics.find((t) => t.logicalKey === create.logicalKey);
          if (!t) {
            t = { ...create, id: `topic-${topics.length}`, isActive: true };
            topics.push(t);
          }
          return t;
        }),
      },
      notificationTopicSubscription: {
        findUnique: vi.fn(
          async ({ where }: any) =>
            subscriptions.find((s) =>
              Object.entries(where.bindingId_tokenHash_topicId).every(
                ([k, v]) => s[k] === v,
              ),
            ) ?? null,
        ),
        upsert: vi.fn(async ({ where, create, update }: any) => {
          let s = subscriptions.find((s) =>
            Object.entries(where.bindingId_tokenHash_topicId).every(
              ([k, v]) => s[k] === v,
            ),
          );
          if (s) Object.assign(s, update);
          else {
            s = { ...create, id: `sub-${subscriptions.length}`, applied: null };
            subscriptions.push(s);
          }
          return s;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          for (const s of subscriptions)
            if (
              s.deviceId === where.deviceId &&
              s.desired &&
              !where.id.notIn.includes(s.id)
            )
              Object.assign(s, data);
        }),
        findMany: vi.fn(async () => []),
      },
    };
    service = new NotificationTopicService(
      tx,
      { transaction: (fn: any) => fn(tx) } as any,
      new ConfigService({ PUSH_ENVIRONMENT: 'test' }),
    );
  });
  const desired = (topics: any[], subs: any[]) =>
    subs
      .filter((s) => s.desired)
      .map((s) => topics.find((t) => t.id === s.topicId).logicalKey)
      .sort();
  it('isolates physical topic names and uses normalized stable group dimensions', () => {
    const name = topicName(
      'test',
      'tenant',
      'binding',
      'RIDER_APP',
      'all_users',
    );
    expect(name).toMatch(/^[A-Za-z0-9_]+$/);
    for (const args of [
      ['prod', 'tenant', 'binding', 'RIDER_APP'],
      ['test', 'other', 'binding', 'RIDER_APP'],
      ['test', 'tenant', 'other', 'RIDER_APP'],
    ])
      expect(
        topicName(args[0], args[1], args[2], args[3], 'all_users'),
      ).not.toBe(name);
    expect(audienceTopicKeys('FLEET_MANAGER', [])).toEqual([
      'all_employees',
      'all_fleet_managers',
      'all_users',
    ]);
  });
  it('creates fixed/dynamic topics once, without marketing until explicit consent', async () => {
    await service.plan('device');
    await service.plan('device');
    expect(desired(topics, subscriptions)).toEqual([
      'all_city_delhi_riders',
      'all_hub_hub_riders',
      'all_oem_oem_riders',
      'all_riders',
      'all_users',
      'all_vehicle_type_type_riders',
      'category_PG01_ANNOUNCEMENTS',
    ]);
    expect(subscriptions).toHaveLength(7);
    consent = true;
    await service.plan('device');
    expect(desired(topics, subscriptions)).toContain('category_PG11_OFFERS');
    consent = false;
    disabled = ['PG01_ANNOUNCEMENTS'];
    await service.plan('device');
    expect(desired(topics, subscriptions)).not.toContain(
      'category_PG11_OFFERS',
    );
    expect(desired(topics, subscriptions)).not.toContain(
      'category_PG01_ANNOUNCEMENTS',
    );
    expect(
      tx.notificationApplicationCategory.findMany.mock.calls[0][0].where
        .category.OR,
    ).toEqual([{ parentCode: 'PG01' }, { parentCode: 'PG11' }]);
  });
  it('retains old-token cleanup intent on token rotation and disables all on logout/role mismatch', async () => {
    await service.plan('device');
    d.token = 'new-token';
    d.tokenHash = 'new-hash';
    d.version = 2;
    await service.plan('device');
    expect(
      subscriptions.filter((s) => s.token === 'token').every((s) => !s.desired),
    ).toBe(true);
    expect(
      subscriptions
        .filter((s) => s.desired)
        .every((s) => s.token === 'new-token' && s.deviceVersion === 2),
    ).toBe(true);
    d.user.role = 'FLEET_MANAGER';
    await service.plan('device');
    expect(subscriptions.every((s) => !s.desired)).toBe(true);
    d.user.role = 'RIDER';
    await service.plan('device');
    d.session.revokedAt = new Date();
    await service.plan('device');
    expect(subscriptions.every((s) => !s.desired)).toBe(true);
  });
  it('removes disabled topics and permission-disabled devices', async () => {
    await service.plan('device');
    topics[0].isActive = false;
    await service.plan('device');
    expect(subscriptions.find((s) => s.topicId === topics[0].id).desired).toBe(
      false,
    );
    d.isActive = false;
    await service.plan('device');
    expect(subscriptions.every((s) => !s.desired)).toBe(true);
  });
  it('scopes subscription status to owner/session and device version and rejects other tenants', async () => {
    const actor: any = { id: 'user', clientId: 'tenant', sessionId: 'session' };
    await service.status('tenant', actor, 'installation', 'RIDER_APP');
    expect(tx.pushDevice.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: 'tenant',
        userId: 'user',
        sessionId: 'session',
        installationId: 'installation',
        appCode: 'RIDER_APP',
      },
    });
    expect(
      tx.notificationTopicSubscription.findMany.mock.calls[0][0].where
        .deviceVersion,
    ).toBe(1);
    await expect(
      service.status('other', actor, 'installation', 'RIDER_APP'),
    ).rejects.toThrow('mismatch');
    tx.pushDevice.findFirst.mockResolvedValue(null);
    await expect(
      service.status('tenant', actor, 'installation', 'RIDER_APP'),
    ).rejects.toThrow('not found');
  });
});

describe('topic dispatch retries', () => {
  it('disables only the failed token snapshot on invalid-token responses', async () => {
    const tx: any = {
      pushDevice: { updateMany: vi.fn() },
      notificationTopicSubscription: { updateMany: vi.fn() },
    };
    const db: any = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: 'sub', desired: true, attempts: 0 }]),
      $transaction: (fn: any) => fn(tx),
      notificationTopicSubscription: {
        findMany: vi.fn().mockResolvedValue([{ id: 'sub', deviceId: null }]),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'sub',
          bindingId: 'binding',
          clientId: 'client',
          tokenHash: 'old-token-hash',
          token: 'old-token',
          topic: { logicalKey: 'all_users', name: 'topic' },
        }),
      },
    };
    const worker = new NotificationTopicWorker(
      db,
      { environment: 'test' } as any,
      {
        manageTopic: vi.fn().mockResolvedValue({
          accepted: false,
          invalidToken: true,
          code: 'messaging/registration-token-not-registered',
        }),
      } as any,
    );
    await worker.dispatch();
    expect(tx.pushDevice.updateMany).toHaveBeenCalledWith({
      where: {
        notificationAppBindingId: 'binding',
        tokenHash: 'old-token-hash',
      },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(tx.notificationTopicSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          desired: false,
          applied: false,
          nextAttemptAt: null,
        }),
      }),
    );
  });
  it('continues other devices when one planner fails', async () => {
    const db: any = {
      pushDevice: { updateMany: vi.fn() },
      notificationTopicSubscription: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: 'a', deviceId: 'bad' },
          { id: 'b', deviceId: 'good' },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const plan = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('bad data');
    });
    const worker = new NotificationTopicWorker(
      db,
      { environment: 'test', plan } as any,
      { manageTopic: vi.fn() } as any,
    );
    await worker.dispatch();
    expect(plan).toHaveBeenCalledWith('good');
    expect(db.notificationTopicSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deviceId: 'bad',
          binding: { environment: 'test' },
        }),
        data: expect.objectContaining({
          nextAttemptAt: expect.any(Date),
          lastError: 'TOPIC_PLANNING_FAILED',
        }),
      }),
    );
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('defers configuration errors without attempts and marks an uncertain operation for retry', async () => {
    const db: any = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ id: 'sub', desired: true, attempts: 0 }]),
      notificationTopicSubscription: {
        findMany: vi.fn().mockResolvedValue([{ id: 'sub', deviceId: null }]),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'sub',
          bindingId: 'binding',
          clientId: 'client',
          token: 'secret-token',
          topic: { logicalKey: 'all_users', name: 'topic' },
        }),
        updateMany: vi.fn(),
      },
    };
    const provider: any = {
      manageTopic: vi.fn().mockResolvedValue({
        accepted: false,
        deferred: true,
        code: 'PUSH_CONFIGURATION_UNAVAILABLE',
      }),
    };
    const worker = new NotificationTopicWorker(
      db,
      { environment: 'test', plan: vi.fn() } as any,
      provider,
    );
    await worker.dispatch();
    expect(db.$queryRaw.mock.calls[0][0].text).toContain('applied=NULL');
    const data =
      db.notificationTopicSubscription.updateMany.mock.calls[0][0].data;
    expect(data.attempts).toBeUndefined();
    expect(data.claimId).toBeNull();
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});
