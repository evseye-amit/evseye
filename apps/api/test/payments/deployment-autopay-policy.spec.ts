import { describe, expect, it, vi } from 'vitest';
import { DeploymentAutoPayPolicyService } from '../../src/payments/deployment-autopay-policy.service.js';

function fixture() {
  const settings: Record<string, string> = {
    RAZORPAY_ENVIRONMENT: 'TEST',
    RAZORPAY_ENABLED: 'true',
    RAZORPAY_AUTOPAY_ENABLED: 'true',
    RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED: 'true',
  };
  let policy: any = {
    clientId: 'client',
    enabled: true,
    revision: 3,
    updatedAt: new Date(),
    updatedBy: null,
  };
  const config: any = {
    mandateMaxAmount: '20000',
    validityDays: 365,
    paymentMethods: ['UPI_AUTOPAY'],
    authorizationAmount: '1',
  };
  const merchant: any = {
    clientId: 'client',
    provider: 'RAZORPAY',
    environment: 'TEST',
    status: 'ACTIVE',
    validFrom: new Date(0),
    validUntil: null,
    currentVersion: 2,
    keyId: 'key',
    secretReference: 'env:MERCHANT',
    versions: [
      {
        clientId: 'client',
        version: 2,
        provider: 'RAZORPAY',
        environment: 'TEST',
        keyId: 'key',
        secretReference: 'env:MERCHANT',
        credentialFingerprint: 'fingerprint',
      },
    ],
  };
  const db: any = {
    clientDeploymentAutoPayPolicy: {
      findUnique: vi.fn(async () => policy),
      upsert: vi.fn(async ({ create, update }) => {
        policy = { ...(policy ?? create), ...update };
        return policy;
      }),
    },
    clientPaymentProvider: { findMany: vi.fn(async () => [merchant]) },
    clientSubscription: {
      findFirst: vi.fn(async () => ({
        package: {
          isActive: true,
          features: [{ feature: { configuration: config } }],
        },
      })),
    },
    user: { findFirst: vi.fn(async () => ({ name: 'Admin' })) },
    auditLog: { create: vi.fn(), findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(),
  };
  db.$transaction = vi.fn(async (fn) => fn(db));
  const service = new DeploymentAutoPayPolicyService(db, {
    get: (key: string) => settings[key],
  } as never);
  return {
    service,
    db,
    settings,
    config,
    merchant,
    policy,
    setMissing: () => {
      policy = null;
    },
  };
}

describe('Client onboarding AutoPay policy', () => {
  it('defaults new clients off and caps package terms at INR 15,000', async () => {
    const f = fixture();
    f.setMissing();
    expect(await f.service.get('client')).toMatchObject({
      enabled: false,
      revision: 0,
      canEnable: true,
      effectiveEnabled: false,
      terms: { maxAmount: '15000.00', validityDays: 365 },
    });
  });
  it.each([
    'RAZORPAY_ENABLED',
    'RAZORPAY_AUTOPAY_ENABLED',
    'RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED',
  ])('keeps saved preference when %s blocks availability', async (flag) => {
    const f = fixture();
    f.settings[flag] = 'false';
    expect(await f.service.get('client')).toMatchObject({
      enabled: true,
      canEnable: false,
      effectiveEnabled: false,
    });
    await expect(
      f.service.set('client', 'admin', { enabled: false, revision: 3 }),
    ).resolves.toMatchObject({ enabled: false, revision: 4 });
  });
  it('requires an active, unambiguous merchant with a matching sealed snapshot', async () => {
    const f = fixture();
    f.merchant.versions[0].keyId = 'old-key';
    expect(await f.service.get('client')).toMatchObject({
      canEnable: false,
      reason: 'MERCHANT_UNAVAILABLE',
    });
    f.merchant.versions[0].keyId = 'key';
    f.db.clientPaymentProvider.findMany.mockResolvedValue([
      f.merchant,
      f.merchant,
    ]);
    expect(await f.service.get('client')).toMatchObject({
      canEnable: false,
      reason: 'MERCHANT_UNAVAILABLE',
    });
  });
  it('rejects package absence, unsupported methods and invalid terms', async () => {
    const f = fixture();
    f.config.paymentMethods = ['ENACH'];
    expect(await f.service.get('client')).toMatchObject({
      reason: 'PACKAGE_UNAVAILABLE',
    });
    f.config.paymentMethods = ['UPI_AUTOPAY'];
    f.config.validityDays = 1.5;
    expect(await f.service.get('client')).toMatchObject({
      reason: 'PACKAGE_TERMS_INVALID',
    });
    f.config.validityDays = 365;
    f.config.authorizationAmount = '20001';
    expect(await f.service.get('client')).toMatchObject({
      reason: 'PACKAGE_TERMS_INVALID',
    });
    f.db.clientSubscription.findFirst.mockResolvedValue(null);
    expect(await f.service.get('client')).toMatchObject({
      reason: 'PACKAGE_UNAVAILABLE',
    });
  });
  it('increments revision on every toggle and records tenant-scoped history atomically', async () => {
    const f = fixture();
    await f.service.set('client', 'admin', { enabled: false, revision: 3 });
    expect(f.db.$queryRaw).toHaveBeenCalled();
    expect(f.db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client',
        actorId: 'admin',
        entityId: 'client',
        previousData: { enabled: true, revision: 3 },
        newData: { enabled: false, revision: 4 },
      }),
    });
    await f.service.set('client', 'admin', { enabled: true, revision: 4 });
    expect(await f.service.get('client')).toMatchObject({
      revision: 5,
      effectiveEnabled: true,
      updatedByName: 'Admin',
    });
  });
  it('rejects stale saves without overwriting the current preference', async () => {
    const f = fixture();
    await expect(
      f.service.set('client', 'admin', { enabled: false, revision: 2 }),
    ).rejects.toMatchObject({ response: { code: 'POLICY_REVISION_CONFLICT' } });
    expect(f.db.clientDeploymentAutoPayPolicy.upsert).not.toHaveBeenCalled();
    expect(f.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('prevents enabling without prerequisites and does not record unchanged saves', async () => {
    const f = fixture();
    f.policy.enabled = false;
    f.settings.RAZORPAY_ENABLED = 'false';
    await expect(
      f.service.set('client', 'admin', { enabled: true, revision: 3 }),
    ).rejects.toMatchObject({ response: { code: 'RAZORPAY_DISABLED' } });
    await f.service.set('client', 'admin', { enabled: false, revision: 3 });
    expect(f.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('scopes policy, merchant, package and history reads to the session client', async () => {
    const f = fixture();
    await f.service.get('other');
    await f.service.history('other', 2);
    expect(f.db.clientDeploymentAutoPayPolicy.findUnique).toHaveBeenCalledWith({
      where: { clientId: 'other' },
    });
    expect(f.db.clientPaymentProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'other', environment: 'TEST' },
      }),
    );
    expect(f.db.clientSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'other' }),
      }),
    );
    expect(f.db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'other',
          entityId: 'other',
        }),
        skip: 20,
        take: 21,
      }),
    );
  });
  it('returns paginated audit rows with JSON-safe identifiers', async () => {
    const f = fixture();
    f.db.auditLog.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: BigInt(i),
        actor: { name: 'Admin' },
        newData: { enabled: true },
      })),
    );
    const result = await f.service.history('client', 1);
    expect(result.items).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.items[0]).toMatchObject({ id: '0', actorName: 'Admin' });
  });
});
