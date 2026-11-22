import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { HttpException } from '@nestjs/common';
import { of } from 'rxjs';
import {
  compareRelease,
  evaluatePolicy,
  validateSettings,
} from '../../src/app-updates/app-update-policy.js';
import {
  AppCheckDto,
  SaveAppPolicyDto,
} from '../../src/app-updates/app-update.dto.js';
import { AppUpdateService } from '../../src/app-updates/app-update.service.js';
import { AppUpdateInterceptor } from '../../src/app-updates/app-update.interceptor.js';
import {
  AppUpdateAdminController,
  AuthenticatedAppUpdateController,
  PublicAppUpdateController,
} from '../../src/app-updates/app-update.controller.js';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';

const identity = {
  appCode: 'RIDER_APP' as const,
  platform: 'ANDROID' as const,
  applicationId: 'com.example.rider',
  channel: 'PRODUCTION' as const,
};
const settings = {
  enabled: true,
  minimum: { version: '1.2.0', build: '20' },
  latest: { version: '1.10.0', build: '30' },
  storeUrl: 'https://play.google.com/store/apps/details?id=com.example.rider',
  title: 'Update required',
  message: 'Update to continue.',
  releaseNotes: '',
};
const policy = {
  id: 'policy-a',
  clientId: 'client-a',
  ...identity,
  revision: 3,
  draft: settings,
  published: settings,
  publishedRevision: 2,
};
function fixture() {
  const tx = {
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: 'client-a' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }),
    },
    appUpdatePolicy: {
      findFirst: vi.fn().mockResolvedValue(policy),
      findMany: vi.fn().mockResolvedValue([policy]),
      create: vi.fn().mockResolvedValue({ ...policy, revision: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...policy, revision: 4 }),
    },
    appUpdatePolicyRevision: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ snapshot: settings }),
    },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Admin' }) },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (work: (db: typeof tx) => unknown) => work(tx)),
  };
  return { tx, service: new AppUpdateService(prisma as never) };
}

describe('release policy decisions and validation', () => {
  it.each([
    ['19', 'required_update'],
    ['20', 'optional_update'],
    ['29', 'optional_update'],
    ['30', 'allowed'],
    ['31', 'allowed'],
  ])('Android build %s is %s', (build, decision) => {
    expect(
      evaluatePolicy(settings, { version: '1.0.0', build }, 'ANDROID').decision,
    ).toBe(decision);
  });
  it('allows disabled or absent policies without leaking stale update links', () => {
    for (const value of [null, { ...settings, enabled: false }])
      expect(
        evaluatePolicy(value, { version: '1.0.0', build: '1' }, 'ANDROID'),
      ).toMatchObject({ decision: 'allowed', storeUrl: null, minimum: null });
  });
  it('compares iOS numeric versions, then builds, allowing a build reset on a new version', () => {
    expect(
      compareRelease(
        { version: '1.10.0', build: '1' },
        { version: '1.9.0', build: '999' },
        'IOS',
      ),
    ).toBe(1);
    expect(
      compareRelease(
        { version: '1.0.0', build: '1.10' },
        { version: '1.0.0', build: '1.9' },
        'IOS',
      ),
    ).toBe(1);
    expect(
      compareRelease(
        { version: '1.0.0', build: '1.0' },
        { version: '1.0.0', build: '1' },
        'IOS',
      ),
    ).toBe(0);
    expect(
      evaluatePolicy(settings, { version: '1.2.0', build: '19' }, 'IOS')
        .decision,
    ).toBe('required_update');
  });
  it('uses Android build codes even when the display version is higher', () => {
    expect(
      evaluatePolicy(settings, { version: '99.0.0', build: '19' }, 'ANDROID')
        .decision,
    ).toBe('required_update');
  });
  it('rejects reversed release ranges and Android dotted/oversized builds', () => {
    expect(() =>
      validateSettings(identity, {
        ...settings,
        minimum: { version: '1.0.0', build: '31' },
      }),
    ).toThrow('Minimum');
    for (const build of ['1.2', '0', '2100000001'])
      expect(() =>
        validateSettings(identity, {
          ...settings,
          minimum: { version: '1.0.0', build },
        }),
      ).toThrow('Android');
  });
  it.each([
    'javascript:alert(1)',
    'https://evil.example/store/apps/details?id=com.example.rider',
    'https://play.google.com/store/apps/details?id=com.other.rider',
    'https://user:pass@play.google.com/store/apps/details?id=com.example.rider',
  ])('rejects unsafe or mismatched store link %s', (storeUrl) => {
    expect(() =>
      validateSettings(identity, { ...settings, storeUrl }),
    ).toThrow();
  });
  it('validates App Store links and rejects a zero iOS build', () => {
    expect(() =>
      validateSettings(
        { ...identity, platform: 'IOS' },
        {
          ...settings,
          storeUrl: 'https://apps.apple.com/in/app/example/id123456789',
        },
      ),
    ).not.toThrow();
    expect(() =>
      validateSettings(
        { ...identity, platform: 'IOS' },
        { ...settings, minimum: { version: '1.0.0', build: '0.0' } },
      ),
    ).toThrow('iOS build');
  });
  it.each([
    {},
    { expectedRevision: -1 },
    { settings: null },
    { settings: { ...settings, enabled: 'true' } },
    { applicationId: '*' },
    { platform: 'WEB' },
  ])('rejects invalid management bodies %j', async (patch) => {
    const body = Object.keys(patch).length
      ? { ...identity, expectedRevision: 0, settings, ...patch }
      : {};
    expect(
      (
        await validate(plainToInstance(SaveAppPolicyDto, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects nonnumeric, padded and prerelease version metadata', async () => {
    for (const version of ['1.2', '01.2.0', '1.2.0-beta', 'NaN.0.0']) {
      expect(
        (
          await validate(
            plainToInstance(AppCheckDto, {
              ...identity,
              installed: { version, build: '1' },
            }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('policy isolation and lifecycle', () => {
  it('looks up the exact client/app/platform/package/channel and ignores drafts', async () => {
    const { service, tx } = fixture();
    tx.appUpdatePolicy.findFirst.mockResolvedValue({
      ...policy,
      published: null,
    } as never);
    expect(
      await service.check('client-b', {
        ...identity,
        installed: { version: '1.0.0', build: '1' },
      }),
    ).toMatchObject({ decision: 'allowed', clientId: 'client-b' });
    expect(tx.appUpdatePolicy.findFirst).toHaveBeenCalledWith({
      where: { clientId: 'client-b', ...identity },
    });
  });
  it('rejects public company/host mismatch and unavailable clients', async () => {
    const { service, tx } = fixture();
    await expect(service.clientForCode('example', 'client-b')).rejects.toThrow(
      'mismatch',
    );
    tx.client.findFirst.mockResolvedValue(null as never);
    await expect(service.clientForCode('missing')).rejects.toThrow(
      'unavailable',
    );
  });
  it('saves a draft without publishing and records the actor and audit in the transaction', async () => {
    const { service, tx } = fixture();
    await service.save('client-a', 'admin', {
      ...identity,
      settings,
      expectedRevision: 3,
    });
    expect(tx.appUpdatePolicy.updateMany).toHaveBeenCalledWith({
      where: { id: 'policy-a', clientId: 'client-a', revision: 3 },
      data: { draft: settings, revision: { increment: 1 } },
    });
    expect(tx.appUpdatePolicyRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'admin',
          actorName: 'Admin',
          action: 'DRAFT_SAVED',
          revision: 4,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('requires revision zero for a new identity', async () => {
    const { service, tx } = fixture();
    tx.appUpdatePolicy.findFirst.mockResolvedValue(null as never);
    await expect(
      service.save('client-a', 'admin', {
        ...identity,
        settings,
        expectedRevision: 2,
      }),
    ).rejects.toThrow('changed');
    await service.save('client-a', 'admin', {
      ...identity,
      settings,
      expectedRevision: 0,
    });
    expect(tx.appUpdatePolicy.create).toHaveBeenCalledWith({
      data: { clientId: 'client-a', ...identity, draft: settings },
    });
  });
  it('requires store availability confirmation before enabling a draft', async () => {
    const { service, tx } = fixture();
    await expect(
      service.publish('client-a', 'policy-a', 'admin', 3, false),
    ).rejects.toThrow('available');
    expect(tx.appUpdatePolicy.updateMany).not.toHaveBeenCalled();
    await service.publish('client-a', 'policy-a', 'admin', 3, true);
    expect(tx.appUpdatePolicy.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          published: settings,
          publishedRevision: 4,
        }),
      }),
    );
  });
  it('rejects stale revisions and a concurrent write without appending history', async () => {
    const { service, tx } = fixture();
    await expect(
      service.disable('client-a', 'policy-a', 'admin', 2),
    ).rejects.toThrow('changed');
    tx.appUpdatePolicy.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.disable('client-a', 'policy-a', 'admin', 3),
    ).rejects.toThrow('changed');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.appUpdatePolicyRevision.create).not.toHaveBeenCalled();
  });
  it('cannot mutate a policy under another client', async () => {
    const { service, tx } = fixture();
    tx.appUpdatePolicy.findFirst.mockResolvedValue(null as never);
    await expect(
      service.disable('client-b', 'policy-a', 'admin', 3),
    ).rejects.toThrow('not found');
    expect(tx.appUpdatePolicy.findFirst).toHaveBeenCalledWith({
      where: { id: 'policy-a', clientId: 'client-b' },
    });
  });
  it('disables live enforcement immediately and retains a saved draft', async () => {
    const { service, tx } = fixture();
    await service.disable('client-a', 'policy-a', 'admin', 3);
    const data = tx.appUpdatePolicy.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ published: { ...settings, enabled: false } });
    expect(data).not.toHaveProperty('draft');
  });
  it('restores history into a draft without changing the published policy', async () => {
    const { service, tx } = fixture();
    await service.restore('client-a', 'policy-a', 'admin', 3, 1);
    expect(tx.appUpdatePolicyRevision.findUnique).toHaveBeenCalledWith({
      where: { policyId_revision: { policyId: 'policy-a', revision: 1 } },
    });
    const data = tx.appUpdatePolicy.updateMany.mock.calls[0][0].data;
    expect(data).toHaveProperty('draft', settings);
    expect(data).not.toHaveProperty('published');
  });
});

function requestContext(
  headers: object = {},
  clientId: string | null = 'authenticated-client',
  route = '/api/v1/rider-app/home',
) {
  const reply = { header: vi.fn().mockReturnThis() };
  const request = { headers, user: { clientId }, routeOptions: { url: route } };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => reply,
      }),
    } as never,
    reply,
  };
}
const headers = {
  'x-app-code': 'RIDER_APP',
  'x-app-platform': 'ANDROID',
  'x-app-id': 'com.example.rider',
  'x-app-channel': 'PRODUCTION',
  'x-app-version': '1.0.0',
  'x-app-build': '1',
};
describe('mobile enforcement and API contract', () => {
  it('enforces after authentication using the authenticated client and returns the update payload', async () => {
    const result = {
      ...evaluatePolicy(settings, { version: '1.0.0', build: '1' }, 'ANDROID'),
      clientId: 'authenticated-client',
    };
    const check = vi.fn().mockResolvedValue(result),
      next = { handle: vi.fn(() => of('ok')) };
    const { context, reply } = requestContext({
      ...headers,
      'x-client-id': 'other-client',
    });
    try {
      await new AppUpdateInterceptor({ check } as never).intercept(
        context,
        next,
      );
      throw new Error('Expected enforcement');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(426);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'APP_UPDATE_REQUIRED',
        issues: [result],
      });
    }
    expect(check).toHaveBeenCalledWith(
      'authenticated-client',
      expect.objectContaining(identity),
    );
    expect(next.handle).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it.each([
    ['legacy', {}, 'client-a', '/api/v1/rider-app/home'],
    ['platform', headers, null, '/api/v1/platform/clients'],
    ['check', headers, 'client-a', '/api/v1/app-updates/check'],
    ['logout', headers, 'client-a', '/api/v1/auth/logout'],
    ['refresh', headers, 'client-a', '/api/v1/auth/refresh'],
  ])('does not block %s requests', async (_name, metadata, clientId, route) => {
    const check = vi.fn(),
      next = { handle: vi.fn(() => of('ok')) };
    await new AppUpdateInterceptor({ check } as never).intercept(
      requestContext(metadata as object, clientId, route).context,
      next,
    );
    expect(check).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledOnce();
  });
  it('rejects incomplete or malformed metadata instead of silently bypassing enforcement', async () => {
    const check = vi.fn();
    const interceptor = new AppUpdateInterceptor({ check } as never);
    for (const metadata of [
      { 'x-app-code': 'RIDER_APP' },
      { ...headers, 'x-app-build': 'bad' },
      { ...headers, 'x-app-platform': ['ANDROID', 'IOS'] },
    ])
      await expect(
        interceptor.intercept(requestContext(metadata).context, {
          handle: vi.fn(),
        }),
      ).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
  });
  it('lets optional updates and supported releases continue', async () => {
    for (const decision of ['allowed', 'optional_update']) {
      const next = { handle: vi.fn(() => of('ok')) };
      await new AppUpdateInterceptor({
        check: vi.fn().mockResolvedValue({ decision }),
      } as never).intercept(requestContext(headers).context, next);
      expect(next.handle).toHaveBeenCalledOnce();
    }
  });
  it('preserves status/code/update details through the standard exception filter', () => {
    const response = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const result = evaluatePolicy(
      settings,
      { version: '1.0.0', build: '1' },
      'ANDROID',
    );
    new HttpExceptionFilter().catch(
      new HttpException(
        {
          code: 'APP_UPDATE_REQUIRED',
          message: 'Update required',
          issues: [result],
        },
        426,
      ),
      {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ id: 'req-1', headers: {} }),
        }),
      } as never,
    );
    expect(response.status).toHaveBeenCalledWith(426);
    expect(response.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'APP_UPDATE_REQUIRED',
          issues: [result],
        }),
      }),
    );
  });
  it('restricts management to super admins and binds authenticated checks to the token client', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, AppUpdateAdminController)).toEqual([
      'SUPER_ADMIN',
    ]);
    expect(
      Reflect.getMetadata('__guards__', AppUpdateAdminController),
    ).toHaveLength(2);
    const check = vi.fn().mockResolvedValue({ decision: 'allowed' });
    const controller = new AuthenticatedAppUpdateController({ check } as never);
    await controller.check(
      { ...identity, installed: { version: '1.0.0', build: '1' } },
      { id: 'user', clientId: 'client-a', roles: ['RIDER'] },
    );
    expect(check).toHaveBeenCalledWith(
      'client-a',
      expect.objectContaining(identity),
    );
    await expect(
      controller.check({} as never, {
        id: 'admin',
        clientId: null,
        roles: ['SUPER_ADMIN'],
      }),
    ).rejects.toThrow('Client context');
  });
  it('resolves the public host before checking a company policy', async () => {
    const updates = {
      clientForCode: vi.fn().mockResolvedValue('client-a'),
      check: vi.fn().mockResolvedValue({ decision: 'allowed' }),
    };
    const controller = new PublicAppUpdateController(
      updates as never,
      {
        fromRequest: vi.fn().mockResolvedValue({ clientId: 'client-a' }),
      } as never,
    );
    await controller.check(
      {
        ...identity,
        companyCode: 'example',
        installed: { version: '1.0.0', build: '1' },
      },
      {} as never,
    );
    expect(updates.clientForCode).toHaveBeenCalledWith('example', 'client-a');
  });
});
