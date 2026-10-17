import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NotificationService } from './notification.service.js';
import { NotificationWorker } from './notification.worker.js';
import { hash } from './notification.helpers.js';
import type {
  PushProvider,
  PushResult,
  PushTarget,
} from './firebase-push.provider.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';

const url = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe.skipIf(!url)('notification service and worker in PostgreSQL', () => {
  let db!: PrismaClient;
  const configValues: Record<string, unknown> = {
    PUSH_TTL_SECONDS: 86400,
    PUSH_MAX_ATTEMPTS: 3,
    PUSH_BATCH_SIZE: 500,
    PUSH_TOKENS_PER_SECOND: 500,
  };
  const config = { getOrThrow: (key: string) => configValues[key] };
  let configured = true;
  const send = vi.fn<(targets: PushTarget[]) => Promise<PushResult[]>>();
  const provider: PushProvider = {
    get configured() {
      return configured;
    },
    send,
  };
  let service!: NotificationService;
  let worker!: NotificationWorker;
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url: url! } } });
    service = new NotificationService(db as PrismaService, config as never, provider);
    worker = new NotificationWorker(db as PrismaService, config as never, service, provider);
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });
  beforeEach(async () => {
    if (!new URL(url!).pathname.includes('_test_'))
      throw new Error(
        'Notification integration tests require a disposable database with _test_ in its name.',
      );
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "PushDelivery", "UserNotification", "NotificationMessage", "PushDevice", "PushDispatchState" CASCADE',
    );
  });
  async function fixture() {
    configured = true;
    send.mockReset();
    send.mockImplementation(async (targets) =>
      targets.map((_, index) => ({
        accepted: true,
        messageId: `firebase-${index}`,
      })),
    );
    await db.pushDispatchState.upsert({
      where: { id: 'firebase' },
      create: { id: 'firebase', nextAllowedAt: new Date(0) },
      update: { nextAllowedAt: new Date(0), leaseUntil: null, claimId: null },
    });
    const suffix = randomUUID();
    const client = await db.client.create({
      data: {
        name: 'Notification test',
        slug: suffix,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    const other = await db.client.create({
      data: {
        name: 'Other client',
        slug: randomUUID(),
        status: 'ACTIVE',
        isActive: true,
      },
    });
    let phoneIndex = 0;
    const user = async (
      role: 'CLIENT_ADMIN' | 'RIDER' | 'FLEET_MANAGER',
      clientId = client.id,
    ) => {
      const row = await db.user.create({
        data: {
          clientId,
          name: role,
          role,
          mobile: `+919${String(++phoneIndex).padStart(9, '0')}`,
        },
      });
      const session = await db.session.create({
        data: {
          userId: row.id,
          refreshTokenHash: hash(randomUUID()),
          expiresAt: new Date('2099-01-01'),
        },
      });
      const actor: AuthUser = {
        id: row.id,
        clientId,
        roles: [role],
        sessionId: session.id,
      };
      return { row, actor, session };
    };
    const admin = await user('CLIENT_ADMIN');
    const rider = await user('RIDER');
    const rider2 = await user('RIDER');
    const fleet = await user('FLEET_MANAGER');
    const outsider = await user('RIDER', other.id);
    async function register(
      who = rider,
      installationId: string = randomUUID(),
      token: string = randomUUID(),
    ) {
      await service.registerDevice(who.row.clientId!, who.actor, {
        installationId,
        appCode:
          who.row.role === 'FLEET_MANAGER' ? 'FLEET_MANAGER_APP' : 'RIDER_APP',
        platform: 'ANDROID',
        token,
      });
      return db.pushDevice.findUniqueOrThrow({
        where: {
          installationId_appCode: {
            installationId,
            appCode:
              who.row.role === 'FLEET_MANAGER'
                ? 'FLEET_MANAGER_APP'
                : 'RIDER_APP',
          },
        },
      });
    }
    const content = {
      title: 'Service update',
      body: 'Visit your nearest hub.',
    };
    const sendOne = (key = randomUUID()) =>
      service.send(
        client.id,
        admin.actor,
        {
          ...content,
          audience: 'PHONE_NUMBERS',
          phoneNumbers: rider.row.mobile,
        },
        key,
      );
    async function clearGate() {
      await db.pushDispatchState.update({
        where: { id: 'firebase' },
        data: { nextAllowedAt: new Date(0) },
      });
    }
    return {
      client,
      other,
      admin,
      rider,
      rider2,
      fleet,
      outsider,
      register,
      content,
      sendOne,
      clearGate,
    };
  }

  it('normalizes audiences, scopes accounts to their client and freezes a single idempotent inbox entry per user', async () => {
    const f = await fixture();
    await f.register();
    const preview = await service.preview(f.client.id, f.admin.actor, {
      audience: 'PHONE_NUMBERS',
      phoneNumbers: `${f.rider.row.mobile}, ${f.rider.row.mobile.slice(3)}, invalid, ${f.outsider.row.mobile}`,
    });
    expect(preview.users).toBe(1);
    expect(preview.devices).toBe(1);
    expect(preview.duplicatePhoneNumbers).toHaveLength(1);
    expect(preview.invalidPhoneNumbers).toEqual(['invalid']);
    expect(preview.unmatchedPhoneNumbers).toEqual([f.outsider.row.mobile]);
    expect(
      (
        await service.preview(f.client.id, f.admin.actor, {
          audience: 'ALL_USERS',
        })
      ).users,
    ).toBe(4);
    expect(
      (
        await service.preview(f.client.id, f.admin.actor, {
          audience: 'ALL_RIDERS',
        })
      ).users,
    ).toBe(2);
    expect(
      (
        await service.preview(f.client.id, f.admin.actor, {
          audience: 'ALL_FLEET_MANAGERS',
        })
      ).users,
    ).toBe(1);
    await expect(
      service.preview(f.client.id, f.rider.actor, { audience: 'ALL_USERS' }),
    ).rejects.toThrow('Only client admins');
    const key = randomUUID();
    const [first, second] = await Promise.all([f.sendOne(key), f.sendOne(key)]);
    expect(first.id).toBe(second.id);
    expect(
      await db.userNotification.count({ where: { messageId: first.id } }),
    ).toBe(1);
    await expect(
      service.send(
        f.client.id,
        f.admin.actor,
        {
          title: 'Changed',
          body: 'Different',
          audience: 'PHONE_NUMBERS',
          phoneNumbers: f.rider.row.mobile,
        },
        key,
      ),
    ).rejects.toThrow('different notification');
    await expect(
      service.details(f.other.id, f.admin.actor, first.id),
    ).rejects.toThrow('not found');
    await expect(
      db.notificationMessage.update({
        where: { id: first.id },
        data: { title: 'Tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      service.sendToUsers(
        f.client.id,
        [f.outsider.row.id],
        f.content,
        randomUUID(),
      ),
    ).rejects.toThrow('active user in this client');
  }, 30000);

  it('rotates tokens, restricts device registration and skips queued delivery after an account switch', async () => {
    const f = await fixture();
    const device = await f.register();
    const same = await f.register(f.rider, device.installationId, device.token);
    expect(same.version).toBe(device.version);
    const refreshed = await f.register(
      f.rider,
      device.installationId,
      'rotated-token',
    );
    expect(refreshed.version).toBe(device.version + 1);
    await expect(
      service.registerDevice(f.client.id, f.rider.actor, {
        installationId: randomUUID(),
        appCode: 'FLEET_MANAGER_APP',
        token: 'fake',
        platform: 'ANDROID',
      }),
    ).rejects.toThrow('role');
    await service.unregisterDevice(
      f.client.id,
      f.rider2.actor,
      device.installationId,
    );
    expect(
      (await db.pushDevice.findUniqueOrThrow({ where: { id: device.id } }))
        .isActive,
    ).toBe(true);
    const message = await f.sendOne();
    await worker.expandRecipients();
    await f.register(f.outsider, device.installationId, 'outsider-token');
    await worker.dispatch();
    await worker.finishMessages();
    expect(send).not.toHaveBeenCalled();
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'SKIPPED' },
      }),
    ).toBe(1);
    expect(
      (await service.inbox(f.client.id, f.rider.row.id, { limit: 20 })).items,
    ).toHaveLength(1);
    const current = await f.register(f.rider2, randomUUID(), 'outsider-token');
    expect(
      (await db.pushDevice.findUniqueOrThrow({ where: { id: device.id } }))
        .isActive,
    ).toBe(false);
    expect(current.isActive).toBe(true);
  }, 30000);

  it('splits 601 devices into batches at most 500 and preserves one inbox entry', async () => {
    const f = await fixture();
    await db.pushDevice.createMany({
      data: Array.from({ length: 601 }, (_, index) => {
        const token = `${randomUUID()}-${index}`;
        return {
          clientId: f.client.id,
          userId: f.rider.row.id,
          sessionId: f.rider.session.id,
          installationId: randomUUID(),
          appCode: 'RIDER_APP',
          platform: 'ANDROID',
          token,
          tokenHash: hash(token),
        };
      }),
    });
    const message = await f.sendOne();
    await worker.expandRecipients();
    await worker.dispatch();
    await f.clearGate();
    await worker.dispatch();
    await worker.finishMessages();
    expect(send.mock.calls.map(([targets]) => targets.length)).toEqual([
      500, 101,
    ]);
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'ACCEPTED' },
      }),
    ).toBe(601);
    expect(
      await db.userNotification.count({ where: { messageId: message.id } }),
    ).toBe(1);
    expect(
      (
        await db.notificationMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).status,
    ).toBe('COMPLETED');
  }, 60000);

  it('retries only temporary failures, disables invalid tokens and applies shared throttling', async () => {
    const f = await fixture();
    await f.register();
    await f.register();
    await f.register();
    const message = await f.sendOne();
    await worker.expandRecipients();
    send.mockImplementationOnce(async () => [
      { accepted: true, messageId: 'accepted' },
      {
        accepted: false,
        code: 'messaging/quota-exceeded',
        retryable: true,
        retryAfterSeconds: 120,
      },
      {
        accepted: false,
        code: 'messaging/registration-token-not-registered',
        invalidToken: true,
      },
    ]);
    await worker.dispatch();
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'ACCEPTED' },
      }),
    ).toBe(1);
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'RETRY' },
      }),
    ).toBe(1);
    expect(
      await db.pushDevice.count({
        where: { clientId: f.client.id, isActive: false },
      }),
    ).toBe(1);
    const gate = await db.pushDispatchState.findUniqueOrThrow({
      where: { id: 'firebase' },
    });
    expect(gate.nextAllowedAt.getTime() - Date.now()).toBeGreaterThan(115000);
    await worker.dispatch();
    expect(send).toHaveBeenCalledTimes(1);
    await db.pushDelivery.updateMany({
      where: { messageId: message.id, status: 'RETRY' },
      data: { nextAttemptAt: new Date(0) },
    });
    await f.clearGate();
    await worker.dispatch();
    await worker.finishMessages();
    expect(send.mock.calls[1]![0]).toHaveLength(1);
    expect(
      (
        await db.notificationMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).status,
    ).toBe('PARTIAL');
  }, 30000);

  it('keeps inbox entries without devices or credentials and enforces pagination and read ownership', async () => {
    const f = await fixture();
    const first = await f.sendOne();
    await f.sendOne();
    await f.sendOne();
    await worker.expandRecipients();
    await worker.finishMessages();
    expect(
      (
        await db.notificationMessage.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('COMPLETED');
    const page1 = await service.inbox(f.client.id, f.rider.row.id, {
      limit: 2,
    });
    const page2 = await service.inbox(f.client.id, f.rider.row.id, {
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(
      new Set([...page1.items, ...page2.items].map((item) => item.id)).size,
    ).toBe(3);
    expect((await service.unread(f.client.id, f.rider.row.id)).count).toBe(3);
    await expect(
      service.read(f.client.id, f.rider2.row.id, page1.items[0]!.id),
    ).rejects.toThrow('not found');
    await service.read(f.client.id, f.rider.row.id, page1.items[0]!.id);
    expect((await service.unread(f.client.id, f.rider.row.id)).count).toBe(2);
    await service.readAll(f.client.id, f.rider.row.id, page1.items[1]!.id);
    expect((await service.unread(f.client.id, f.rider.row.id)).count).toBe(0);
    await f.register();
    configured = false;
    const waiting = await f.sendOne();
    await worker.expandRecipients();
    await worker.dispatch();
    await worker.finishMessages();
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await db.notificationMessage.findUniqueOrThrow({
          where: { id: waiting.id },
        })
      ).status,
    ).toBe('WAITING_FOR_CONFIGURATION');
    configured = true;
    await f.clearGate();
    await worker.dispatch();
    await worker.finishMessages();
    expect(
      (
        await db.notificationMessage.findUniqueOrThrow({
          where: { id: waiting.id },
        })
      ).status,
    ).toBe('COMPLETED');
  }, 30000);

  it('recovers expired worker leases and skips logged out or expired devices', async () => {
    const f = await fixture();
    await f.register();
    const message = await f.sendOne();
    await worker.expandRecipients();
    await db.pushDelivery.updateMany({
      where: { messageId: message.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        claimId: randomUUID(),
        leaseUntil: new Date(0),
      },
    });
    await worker.dispatch();
    expect(send).toHaveBeenCalledTimes(1);
    await f.clearGate();
    const another = await f.sendOne();
    await worker.expandRecipients();
    await db.session.update({
      where: { id: f.rider.session.id },
      data: { revokedAt: new Date() },
    });
    await worker.dispatch();
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await db.pushDelivery.count({
        where: { messageId: another.id, status: 'SKIPPED' },
      }),
    ).toBe(1);
  }, 30000);
  it('does not disable a freshly rotated token when Firebase rejects the old token in flight', async () => {
    const f = await fixture();
    const device = await f.register();
    const message = await f.sendOne();
    await worker.expandRecipients();
    send.mockImplementationOnce(async () => {
      await f.register(
        f.rider,
        device.installationId,
        'fresh-token-during-send',
      );
      return [
        {
          accepted: false,
          code: 'messaging/registration-token-not-registered',
          invalidToken: true,
        },
      ];
    });
    await worker.dispatch();
    const refreshed = await db.pushDevice.findUniqueOrThrow({
      where: { id: device.id },
    });
    expect(refreshed.isActive).toBe(true);
    expect(refreshed.token).toBe('fresh-token-during-send');
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'FAILED' },
      }),
    ).toBe(1);
  }, 30000);

  it('coordinates concurrent workers and expires undelivered pushes without removing the inbox', async () => {
    const f = await fixture();
    await f.register();
    const message = await f.sendOne();
    await worker.expandRecipients();
    const second = new NotificationWorker(
      db as PrismaService,
      config as never,
      service,
      provider,
    );
    await Promise.all([worker.dispatch(), second.dispatch()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await db.pushDelivery.count({
        where: { messageId: message.id, status: 'ACCEPTED' },
      }),
    ).toBe(1);
    // Use a short-lived message created with a valid past lifetime to exercise expiration.
    const expired = await db.notificationMessage.create({
      data: {
        clientId: f.client.id,
        title: 'Expired',
        body: 'Already expired push',
        audience: 'USER_IDS',
        audiencePhones: [],
        requestKey: randomUUID(),
        requestDigest: hash('expired'),
        totalUsers: 1,
        createdAt: new Date(Date.now() - 120000),
        pushExpiresAt: new Date(Date.now() - 60000),
      },
    });
    await db.userNotification.create({
      data: {
        clientId: f.client.id,
        userId: f.rider.row.id,
        messageId: expired.id,
      },
    });
    configured = false;
    await worker.expandRecipients();
    await worker.finishMessages();
    expect(
      await db.pushDelivery.count({
        where: {
          messageId: expired.id,
          status: 'SKIPPED',
          errorCode: 'PUSH_EXPIRED',
        },
      }),
    ).toBe(1);
    expect(
      (await service.inbox(f.client.id, f.rider.row.id, { limit: 20 })).items,
    ).toHaveLength(2);
  }, 30000);
});
