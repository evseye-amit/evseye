import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { NotificationWorker } from '../../src/notifications/notification.worker.js';
import type { PushProvider } from '../../src/notifications/firebase-push.provider.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
import type { PushTarget } from '../../src/notifications/firebase-push.provider.js';
import { hash } from '../../src/notifications/notification.helpers.js';

const input = {
  installationId: '11111111-1111-4111-8111-111111111111',
  appCode: 'RIDER_APP',
  platform: 'ANDROID',
  token: 'token',
};
const actor: AuthUser = {
  id: 'user',
  clientId: 'client',
  sessionId: 'session',
  roles: ['RIDER'],
};
function registration(bindings: any[], old: any = null) {
  const tx = {
    notificationInstallation: {
      findUnique: vi.fn(async (): Promise<any> => null),
      update: vi.fn(),
    },
    session: { findFirst: vi.fn(async () => ({ id: 'session' })) },
    notificationAppBinding: { findMany: vi.fn(async () => bindings) },
    pushDevice: {
      updateMany: vi.fn(),
      findUnique: vi.fn(async () => old),
      create: vi.fn(async ({ data }) => data),
      update: vi.fn(async ({ data }) => ({ ...old, ...data })),
    },
  };
  const db = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return {
    tx,
    service: new NotificationService(
      db as any,
      new ConfigService({ PUSH_ENVIRONMENT: 'prod' }),
      { configured: true, send: vi.fn() },
    ),
  };
}
describe('device Firebase binding', () => {
  it('selects the tenant/app/platform/environment binding and increments version on rebinding', async () => {
    const { service, tx } = registration([{ id: 'new-binding' }], {
      id: 'device',
      tokenHash: hash('token'),
      userId: 'user',
      clientId: 'client',
      platform: 'ANDROID',
      notificationAppBindingId: 'old-binding',
      isActive: true,
    });
    await service.registerDevice('client', actor, input);
    expect(tx.notificationAppBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client',
          appCode: 'RIDER_APP',
          platform: 'ANDROID',
          environment: 'prod',
        }),
      }),
    );
    expect(tx.pushDevice.update).toHaveBeenCalledWith({
      where: { id: 'device' },
      data: expect.objectContaining({
        notificationAppBindingId: 'new-binding',
        version: { increment: 1 },
      }),
    });
  });
  it('requires installation proof before token ownership changes and binds the exact flavor', async () => {
    const { service, tx } = registration([{ id: 'binding' }]);
    const credential = 'a'.repeat(43);
    tx.notificationInstallation.findUnique.mockResolvedValue({
      id: input.installationId,
      credentialHash: hash(credential),
      clientId: 'client',
      bindingId: 'binding',
      permission: 'DENIED',
    });
    await expect(
      service.registerDevice('client', actor, input),
    ).rejects.toThrow('credential');
    expect(tx.pushDevice.updateMany).not.toHaveBeenCalled();
    const result = await service.registerDevice('client', actor, {
      ...input,
      installationCredential: credential,
    });
    expect(result).toMatchObject({
      lifecycle: 'REGISTERED',
      permission: 'DENIED',
    });
    expect(tx.pushDevice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isActive: false,
        disabledReason: 'NOTIFICATION_PERMISSION_DENIED',
      }),
    });
    expect(tx.notificationInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hasRegistered: true }),
      }),
    );
    tx.notificationInstallation.findUnique.mockResolvedValue({
      credentialHash: hash(credential),
      clientId: 'other',
      bindingId: 'binding',
    });
    await expect(
      service.registerDevice('client', actor, {
        ...input,
        installationCredential: credential,
      }),
    ).rejects.toThrow('mismatch');
  });
  it('reactivates permitted devices with a new version and rejects revoked enrollment', async () => {
    const credential = 'b'.repeat(43);
    const { service, tx } = registration([{ id: 'binding' }], {
      id: 'device',
      tokenHash: hash('token'),
      userId: 'user',
      clientId: 'client',
      notificationAppBindingId: 'binding',
      platform: 'ANDROID',
      isActive: false,
    });
    tx.notificationInstallation.findUnique.mockResolvedValue({
      id: input.installationId,
      credentialHash: hash(credential),
      clientId: 'client',
      bindingId: 'binding',
      permission: 'DENIED',
    });
    await service.registerDevice('client', actor, {
      ...input,
      installationCredential: credential,
      permission: 'AUTHORIZED',
    });
    expect(tx.pushDevice.update).toHaveBeenCalledWith({
      where: { id: 'device' },
      data: expect.objectContaining({
        isActive: true,
        version: { increment: 1 },
      }),
    });
    tx.notificationInstallation.findUnique.mockResolvedValue({
      revokedAt: new Date(),
    });
    await expect(
      service.registerDevice('client', actor, {
        ...input,
        installationCredential: credential,
      }),
    ).rejects.toThrow('revoked');
  });
  it('preserves old app registration without guessing a binding', async () => {
    const { service, tx } = registration([]);
    expect(await service.registerDevice('client', actor, input)).toMatchObject({
      pushBindingStatus: 'UNCONFIGURED',
    });
    expect(
      tx.pushDevice.create.mock.calls[0]![0].data.notificationAppBindingId,
    ).toBeNull();
  });
  it('rejects ambiguous flavors before changing token ownership', async () => {
    const { service, tx } = registration([{ id: 'a' }, { id: 'b' }]);
    await expect(
      service.registerDevice('client', actor, input),
    ).rejects.toThrow('applicationId');
    expect(tx.pushDevice.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a supplied unrecognized app identity and wrong Team Leader role', async () => {
    const { service } = registration([]);
    await expect(
      service.registerDevice('client', actor, {
        ...input,
        applicationId: 'wrong.package',
      }),
    ).rejects.toThrow('No active Firebase');
    await expect(
      service.registerDevice('client', actor, {
        ...input,
        appCode: 'TEAM_LEADER_APP',
      }),
    ).rejects.toThrow('account role');
  });
});
function delivery(id: string) {
  return {
    id,
    deviceId: id,
    deviceVersion: 1,
    attempts: 1,
    firstAttemptAt: new Date(),
    messageId: 'message',
    userNotificationId: 'notice',
    device: {
      token: 'token',
      tokenHash: 'hash',
      version: 1,
      isActive: true,
      userId: 'user',
      clientId: 'client',
      appCode: 'RIDER_APP',
      platform: 'ANDROID',
      notificationAppBindingId: id,
      session: {
        userId: 'user',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 600000),
      },
      user: {
        isActive: true,
        deletedAt: null,
        client: { isActive: true, status: 'ACTIVE' },
      },
    },
    userNotification: { userId: 'user', clientId: 'client' },
    message: {
      title: 'title',
      body: 'body',
      data: {},
      pushExpiresAt: new Date(Date.now() + 600000),
    },
  };
}
describe('project dispatch isolation', () => {
  it('releases separate project leases and preserves retry budget when credentials are unavailable', async () => {
    const updates: any[] = [];
    const gates: any[] = [];
    const db: any = {
      pushDelivery: {
        findMany: vi.fn(async ({ where }) => [delivery(where.claimId)]),
        updateMany: vi.fn(async (arg) => {
          updates.push(arg);
          return { count: 1 };
        }),
      },
      pushDispatchState: {
        updateMany: vi.fn(async (arg) => {
          gates.push(arg);
        }),
      },
      pushDevice: { updateMany: vi.fn() },
    };
    db.$transaction = async (fn: any) => fn(db);
    const provider: PushProvider = {
      configured: true,
      scopes: async () => [
        { id: 'a', configurationId: 'ca' },
        { id: 'b', configurationId: 'cb' },
      ],
      send: vi.fn(async (targets: PushTarget[]) =>
        targets.map((t) =>
          t.bindingId === 'a'
            ? { accepted: false, deferred: true }
            : { accepted: true, messageId: 'accepted' },
        ),
      ),
    };
    const worker = new NotificationWorker(
      db,
      new ConfigService({ PUSH_MAX_ATTEMPTS: 6 }),
      {
        eligibleForDeliveries: async (_client: string, ids: string[]) =>
          new Set(ids),
      } as any,
      provider,
    );
    vi.spyOn(worker as any, 'claim').mockImplementation(
      async (scope: any) => scope.id,
    );
    await worker.dispatch();
    expect(updates.find((u) => u.where.id === 'a').data).toMatchObject({
      status: 'RETRY',
      attempts: { decrement: 1 },
      firstAttemptAt: null,
      errorCode: 'PUSH_CONFIGURATION_UNAVAILABLE',
    });
    expect(updates.find((u) => u.where.id === 'b').data.status).toBe(
      'ACCEPTED',
    );
    expect(gates.map((g) => g.where.id).sort()).toEqual(['a', 'b']);
  });
  it('claims only devices belonging to the selected project and uses its gate', async () => {
    const queries: any[] = [];
    const tx: any = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(async (sql) => {
        queries.push(sql);
        return sql.sql.includes('PushDispatchState')
          ? [{ nextAllowedAt: new Date(0), leaseUntil: null }]
          : [];
      }),
      pushDelivery: { updateMany: vi.fn() },
    };
    const worker = new NotificationWorker(
      { $transaction: async (fn: any) => fn(tx) } as any,
      new ConfigService({
        PUSH_MAX_ATTEMPTS: 6,
        PUSH_BATCH_SIZE: 100,
        PUSH_TOKENS_PER_SECOND: 100,
      }),
      {} as any,
      { configured: true, send: vi.fn() },
    );
    await (worker as any).claim({
      id: 'firebase:prod:project',
      configurationId: 'project',
    });
    expect(queries[0].values).toContain('firebase:prod:project');
    expect(queries[1].values).toContain('project');
    expect(queries[1].sql).toContain('b."clientId" = pd."clientId"');
  });
});
