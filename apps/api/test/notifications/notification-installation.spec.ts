import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationInstallationService } from '../../src/notifications/notification-installation.service.js';
import { hash } from '../../src/notifications/notification.helpers.js';
import { UpdateInstallationDto } from '../../src/notifications/notification-installation.dto.js';

describe('independent notification installations', () => {
  const credential = 'x'.repeat(43);
  let tx: any, service: NotificationInstallationService, row: any;
  beforeEach(() => {
    row = {
      id: 'installation',
      clientId: 'tenant',
      bindingId: 'binding',
      credentialHash: hash(credential),
      permission: 'NOT_DETERMINED',
      onboardingState: 'UNREGISTERED',
      hasRegistered: false,
    };
    tx = {
      notificationAppBinding: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'binding',
          clientId: 'tenant',
          appCode: 'RIDER_APP',
        }),
      },
      notificationInstallation: {
        findUnique: vi.fn(async () => row),
        create: vi.fn(async ({ data }) => ({ ...row, ...data })),
        update: vi.fn(async ({ data }) => ({ ...row, ...data })),
      },
      session: { findFirst: vi.fn().mockResolvedValue({ id: 'session' }) },
      pushDevice: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    };
    service = new NotificationInstallationService(
      { transaction: (fn: any) => fn(tx) } as any,
      new ConfigService({ PUSH_ENVIRONMENT: 'test' }),
    );
  });
  it('issues a random credential once and persists only its hash with binding-derived tenant', async () => {
    const result = await service.enroll({ bindingId: 'binding', token: 'fcm' });
    expect(result.installationCredential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      tx.notificationInstallation.create.mock.calls[0][0].data,
    ).toMatchObject({
      clientId: 'tenant',
      credentialHash: hash(result.installationCredential),
      tokenHash: hash('fcm'),
    });
    expect(
      tx.notificationAppBinding.findFirst.mock.calls[0][0].where,
    ).toMatchObject({ environment: 'test', isActive: true });
    expect(result).not.toHaveProperty('credentialHash');
  });
  it('rejects missing, wrong and revoked credentials before returning installation state', async () => {
    for (const proof of [undefined, 'installation', 'y'.repeat(43)])
      await expect(service.access('installation', proof)).rejects.toThrow(
        'credential',
      );
    row.revokedAt = new Date();
    await expect(service.access('installation', credential)).rejects.toThrow(
      'credential',
    );
    expect(tx.notificationInstallation.update).not.toHaveBeenCalled();
  });
  it('does not reinterpret a logged-out installation as a new user', async () => {
    row.hasRegistered = true;
    expect(
      await service.access('installation', credential, {
        onboardingState: 'REGISTRATION_STARTED',
      }),
    ).toMatchObject({ lifecycle: 'LOGGED_OUT' });
    expect(
      tx.notificationInstallation.update.mock.calls[0][0].data,
    ).not.toHaveProperty('onboardingState');
  });
  it('requires authenticated updates for a registered session even with denied permission', async () => {
    row.hasRegistered = true;
    Object.assign(row, {
      clientId: 'tenant',
      userId: 'user',
      isActive: false,
      disabledReason: 'NOTIFICATION_PERMISSION_DENIED',
      session: { userId: 'user', expiresAt: new Date(Date.now() + 60000) },
      user: { isActive: true },
    });
    expect(await service.access('installation', credential)).toMatchObject({
      lifecycle: 'REGISTERED',
    });
    await expect(
      service.access('installation', credential, { token: 'replacement' }),
    ).rejects.toThrow('authenticated');
    expect(
      await service.access('installation', credential, undefined, true),
    ).toEqual({ revoked: true });
    expect(tx.pushDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          version: { increment: 1 },
        }),
      }),
    );
  });
  it('treats expired sessions as logged out and never returns account identity or token', async () => {
    row.hasRegistered = true;
    Object.assign(row, {
      clientId: 'tenant',
      userId: 'secret-user',
      session: { userId: 'secret-user', expiresAt: new Date(0) },
      user: { isActive: true },
    });
    const state = await service.access('installation', credential, {
      permission: 'DENIED',
    });
    expect(state).toEqual({
      installationId: 'installation',
      appCode: 'RIDER_APP',
      permission: 'DENIED',
      lifecycle: 'LOGGED_OUT',
    });
    expect(tx.pushDevice.updateMany).toHaveBeenCalled();
  });
  it('claims without a Firebase token and disables any earlier account token', async () => {
    const actor: any = {
      id: 'user',
      clientId: 'tenant',
      sessionId: 'session',
      roles: ['RIDER'],
    };
    expect(
      await service.claim('installation', credential, actor),
    ).toMatchObject({
      lifecycle: 'REGISTERED',
      pushRegistrationRequired: true,
    });
    expect(tx.notificationInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user',
          sessionId: 'session',
          hasRegistered: true,
        }),
      }),
    );
    expect(tx.pushDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    await expect(
      service.claim('installation', credential, {
        ...actor,
        clientId: 'other',
      }),
    ).rejects.toThrow('mismatch');
    tx.session.findFirst.mockResolvedValue(null);
    await expect(
      service.claim('installation', credential, actor),
    ).rejects.toThrow('Session');
  });
  it('records permission without a token and stops pushes on denial even for the same account', async () => {
    const actor: any = {
      id: 'user',
      clientId: 'tenant',
      sessionId: 'session',
      roles: ['RIDER'],
    };
    Object.assign(row, {
      userId: 'user',
      sessionId: 'session',
      hasRegistered: true,
    });
    await service.claim('installation', credential, actor);
    expect(tx.pushDevice.updateMany).not.toHaveBeenCalled();
    expect(
      await service.claim('installation', credential, actor, 'DENIED'),
    ).toMatchObject({ permission: 'DENIED' });
    expect(tx.pushDevice.updateMany).toHaveBeenCalled();
    expect(tx.notificationInstallation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ permission: 'DENIED' }),
      }),
    );
  });
  it('rejects inactive bindings and invalid DTO permission/lifecycle values', async () => {
    tx.notificationAppBinding.findFirst.mockResolvedValue(null);
    await expect(service.enroll({ bindingId: 'binding' })).rejects.toThrow(
      'unavailable',
    );
    for (const input of [
      { permission: null },
      { onboardingState: 'REGISTERED' },
      { token: '' },
      { token: null },
    ])
      expect(
        (await validate(plainToInstance(UpdateInstallationDto, input))).length,
      ).toBeGreaterThan(0);
  });
});
