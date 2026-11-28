import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NotificationConfigurationService } from '../../src/notifications/notification-configuration.service.js';
import type { AuthUser } from '../../src/auth/interfaces/auth-user.interface.js';
const admin: AuthUser = { id: 'admin', clientId: null, roles: ['SUPER_ADMIN'] };
const input = {
  clientId: 'client',
  appCode: 'RIDER_APP',
  platform: 'ANDROID',
  applicationId: 'com.example.app',
  projectId: 'example-project',
  credentialReference: 'CLIENT_SECRET',
};
function setup(old: any = null) {
  const tx = {
    client: { findFirst: vi.fn(async () => ({ id: 'client' })) },
    firebaseProjectConfiguration: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({
        id: 'config',
        projectId: 'example-project',
        credentialVersion: 2,
      })),
    },
    notificationAppBinding: {
      findUnique: vi.fn(async () => old),
      upsert: vi.fn(async (_args: unknown) => ({ id: 'binding' })),
    },
    auditLog: { create: vi.fn() },
  };
  const db = { $transaction: vi.fn(async (fn: any) => fn(tx)) };
  const config = new ConfigService({
    PUSH_ENVIRONMENT: 'prod',
    CLIENT_SECRET: JSON.stringify({
      type: 'service_account',
      project_id: 'example-project',
      client_email: 'test@example-project.iam.gserviceaccount.com',
      private_key: 'sensitive-key',
    }),
  });
  return {
    tx,
    db,
    config,
    service: new NotificationConfigurationService(db as any, config),
  };
}
describe('Firebase binding provisioning', () => {
  it('requires platform admin and rejects invalid credentials before any mutation', async () => {
    const { service, db, config } = setup();
    await expect(
      service.configure({ ...admin, roles: ['CLIENT_ADMIN'] }, input),
    ).rejects.toThrow('administrator');
    expect(db.$transaction).not.toHaveBeenCalled();
    config.set('CLIENT_SECRET', 'sensitive-key');
    await expect(service.configure(admin, input)).rejects.toThrow(
      'unavailable',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('audits provisioning without credentials and returns explicit re-registration guidance', async () => {
    const { service, tx } = setup();
    expect(await service.configure(admin, input)).toMatchObject({
      environment: 'prod',
      readiness: 'CREDENTIAL_VALIDATED',
      requiresDeviceRegistration: true,
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(
      'sensitive-key',
    );
    expect(tx.notificationAppBinding.upsert.mock.calls[0]![0]).toMatchObject({
      create: {
        clientId: 'client',
        firebaseConfigurationId: 'config',
        environment: 'prod',
      },
    });
  });
  it('refuses silently moving existing installations to a different project', async () => {
    const { service, tx } = setup({ firebaseConfigurationId: 'other-config' });
    await expect(service.configure(admin, input)).rejects.toThrow(
      'cannot change Firebase project',
    );
    expect(tx.notificationAppBinding.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
