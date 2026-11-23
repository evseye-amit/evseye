import { topicName } from '../../src/notifications/notification-topic.helpers.js';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cert, getApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  FirebasePushProvider,
  type PushTarget,
} from '../../src/notifications/firebase-push.provider.js';
import { parseFirebaseServiceAccount } from '../../src/config/firebase-credentials.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

vi.mock('firebase-admin/app', () => ({
  cert: vi.fn((v) => v),
  getApp: vi.fn(),
  initializeApp: vi.fn((options, name) => ({ options, name })),
}));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: vi.fn() }));
const account = (project = 'project-a') => ({
  type: 'service_account',
  project_id: project,
  client_email: `test@${project}.iam.gserviceaccount.com`,
  private_key: 'sensitive-test-only-value',
});
const binding = (id = 'a') => ({
  id,
  clientId: `client-${id}`,
  appCode: 'RIDER_APP',
  platform: 'ANDROID',
  firebaseConfigurationId: `config-${id}`,
  firebaseConfiguration: {
    id: `config-${id}`,
    projectId: `project-${id}`,
    credentialVersion: 1,
    credentialReference: `SECRET_${id.toUpperCase()}`,
  },
});
const target = (id = 'a'): PushTarget => ({
  bindingId: id,
  clientId: `client-${id}`,
  appCode: 'RIDER_APP',
  platform: 'ANDROID',
  token: `token-${id}`,
  notificationId: 'notice',
  messageId: 'message',
  userId: 'user',
  title: 'title',
  body: 'body',
  data: {},
  expiresAt: new Date(Date.now() + 60000),
});
function setup(bindings = [binding()]) {
  const db = {
    notificationAppBinding: {
      findMany: vi.fn(async (_args?: any) => bindings),
    },
    firebaseProjectConfiguration: {
      findMany: vi.fn(async () =>
        bindings.map((b) => ({ id: b.firebaseConfigurationId })),
      ),
    },
  };
  const config = new ConfigService({
    PUSH_ENABLED: false,
    PUSH_ENVIRONMENT: 'production',
    SECRET_A: JSON.stringify(account()),
    SECRET_B: JSON.stringify(account('project-b')),
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(account('wrong-project')),
  });
  return {
    db,
    config,
    provider: new FirebasePushProvider(config, db as unknown as PrismaService),
  };
}
describe('tenant Firebase routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getApp).mockImplementation(() => {
      throw new Error('No app');
    });
    vi.mocked(getMessaging).mockImplementation(
      (app: any) =>
        ({
          sendEach: vi.fn(async (messages: any[]) => ({
            responses: messages.map((m) => ({
              success: true,
              messageId: `${app.options.projectId}:${m.token}`,
            })),
          })),
        }) as any,
    );
  });
  it('routes subscription and cleanup through the binding project and rejects arbitrary topic names', async () => {
    const calls: any[] = [];
    vi.mocked(getMessaging).mockImplementation(
      (app: any) =>
        ({
          subscribeToTopic: vi.fn(async (tokens, name) => {
            calls.push({
              project: app.options.projectId,
              tokens,
              name,
              subscribe: true,
            });
            return { successCount: 1, errors: [] };
          }),
          unsubscribeFromTopic: vi.fn(async (tokens, name) => {
            calls.push({
              project: app.options.projectId,
              tokens,
              name,
              subscribe: false,
            });
            return { successCount: 1, errors: [] };
          }),
        }) as any,
    );
    const { provider, db } = setup([binding(), binding('b')]);
    const t = {
      bindingId: 'b',
      clientId: 'client-b',
      token: 'token-b',
      logicalKey: 'all_users',
      name: topicName('production', 'client-b', 'b', 'RIDER_APP', 'all_users'),
      subscribe: true,
    };
    expect(await provider.manageTopic(t)).toEqual({ accepted: true });
    expect(calls[0].project).toBe('project-b');
    expect(
      await provider.manageTopic({ ...t, name: 'arbitrary-topic' }),
    ).toMatchObject({ accepted: false, deferred: true });
    expect(await provider.manageTopic({ ...t, subscribe: false })).toEqual({
      accepted: true,
    });
    expect(
      db.notificationAppBinding.findMany.mock.calls.at(-1)?.[0].where,
    ).not.toHaveProperty('isActive');
    expect(calls[1].subscribe).toBe(false);
  });
  it('classifies topic failures without exposing tokens or credentials', async () => {
    vi.mocked(getMessaging).mockReturnValue({
      subscribeToTopic: vi.fn(async () => ({
        successCount: 0,
        errors: [
          {
            index: 0,
            error: { code: 'messaging/registration-token-not-registered' },
          },
        ],
      })),
    } as any);
    const { provider } = setup();
    expect(
      await provider.manageTopic({
        bindingId: 'a',
        clientId: 'client-a',
        token: 'secret-token',
        logicalKey: 'all_users',
        name: topicName(
          'production',
          'client-a',
          'a',
          'RIDER_APP',
          'all_users',
        ),
        subscribe: true,
      }),
    ).toMatchObject({ invalidToken: true, accepted: false });
  });
  it('routes two projects separately while preserving input response order and ignoring PUSH_ENABLED', async () => {
    const { provider } = setup([binding(), binding('b')]);
    expect(await provider.send([target('b'), target()])).toMatchObject([
      { messageId: 'project-b:token-b' },
      { messageId: 'project-a:token-a' },
    ]);
    expect(provider.configured).toBe(true);
    expect(initializeApp).toHaveBeenCalledTimes(2);
  });
  it('does not route an unbound, cross-client or incompatible app endpoint through global credentials', async () => {
    const { provider } = setup();
    const results = await provider.send([
      { ...target(), bindingId: null },
      { ...target(), clientId: 'client-b' },
      { ...target(), appCode: 'FLEET_MANAGER_APP' },
    ]);
    expect(results.every((r) => r.deferred && !r.accepted)).toBe(true);
    expect(getMessaging).not.toHaveBeenCalled();
  });
  it('defers mismatched/missing secrets without disclosing them or disabling tokens', async () => {
    const { provider, config } = setup();
    config.set('SECRET_A', JSON.stringify(account('wrong-project')));
    expect(await provider.send([target()])).toEqual([
      {
        accepted: false,
        deferred: true,
        code: 'PUSH_CONFIGURATION_UNAVAILABLE',
      },
    ]);
    config.set('SECRET_A', '');
    expect(await provider.clientConfigured('client-a')).toBe(false);
    expect(getMessaging).not.toHaveBeenCalled();
  });
  it('rotates the SDK app identity when the secret changes', async () => {
    const { provider, config } = setup();
    await provider.send([target()]);
    config.set(
      'SECRET_A',
      JSON.stringify({ ...account(), private_key: 'rotated-test-key' }),
    );
    await provider.send([target()]);
    expect(vi.mocked(initializeApp).mock.calls[0]![1]).not.toBe(
      vi.mocked(initializeApp).mock.calls[1]![1],
    );
    expect(cert).toHaveBeenCalledTimes(2);
  });
  it('scopes readiness and dispatch discovery by environment and client', async () => {
    const { provider, db } = setup();
    expect(await provider.clientConfigured('client-a')).toBe(true);
    expect(db.notificationAppBinding.findMany.mock.calls[0]).toMatchObject([
      { where: { clientId: 'client-a', environment: 'production' } },
    ]);
    expect(await provider.scopes()).toEqual([
      { id: 'firebase:production:config-a', configurationId: 'config-a' },
    ]);
  });
  it('splits more than 500 tokens into legal SDK batches', async () => {
    const { provider } = setup();
    const results = await provider.send(
      Array.from({ length: 501 }, () => target()),
    );
    expect(results).toHaveLength(501);
    expect(getMessaging).toHaveBeenCalledTimes(2);
  });
  it('keeps one project failure from replacing another project result', async () => {
    const { provider, config } = setup([binding(), binding('b')]);
    config.set('SECRET_A', 'not-json');
    expect(await provider.send([target(), target('b')])).toMatchObject([
      { deferred: true },
      { accepted: true },
    ]);
  });
  it('rejects a mismatched Firebase project', () => {
    expect(() =>
      parseFirebaseServiceAccount(JSON.stringify(account()), 'other'),
    ).toThrow('must match');
  });
  it.each([
    'private-key-sensitive-value',
    JSON.stringify({ private_key: 'private-key-sensitive-value' }),
    'null',
  ])('redacts credential validation errors', (raw) => {
    let error: unknown;
    try {
      parseFirebaseServiceAccount(raw);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private-key-sensitive-value');
  });
});
