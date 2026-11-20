import { describe, expect, it, vi } from 'vitest';
import { AutoPayAvailabilityService } from '../../src/payments/autopay-availability.service.js';

function fixture() {
  const settings: Record<string, string> = {
    UNIFIED_AUTOPAY_ENABLED: 'true',
    UNIFIED_AUTOPAY_CLIENT_IDS: 'client',
    RAZORPAY_ENVIRONMENT: 'TEST',
    RAZORPAY_ENABLED: 'true',
    RAZORPAY_AUTOPAY_ENABLED: 'true',
    RAZORPAY_DEPLOYMENT_AUTOPAY_ENABLED: 'true',
  };
  let policy: any = {
    clientId: 'client',
    enabled: true,
    rechargeAmount: '750.00',
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
    walletAutoRechargePolicy: {
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
  const service = new AutoPayAvailabilityService(db, {
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
    expect(await f.service.availability('client')).toMatchObject({
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
    expect(await f.service.availability('client')).toMatchObject({
      enabled: true,
      canEnable: false,
      effectiveEnabled: false,
    });

  });
  it('requires an active, unambiguous merchant with a matching sealed snapshot', async () => {
    const f = fixture();
    f.merchant.versions[0].keyId = 'old-key';
    expect(await f.service.availability('client')).toMatchObject({
      canEnable: false,
      reason: 'MERCHANT_UNAVAILABLE',
    });
    f.merchant.versions[0].keyId = 'key';
    f.db.clientPaymentProvider.findMany.mockResolvedValue([
      f.merchant,
      f.merchant,
    ]);
    expect(await f.service.availability('client')).toMatchObject({
      canEnable: false,
      reason: 'MERCHANT_UNAVAILABLE',
    });
  });
  it('rejects package absence, unsupported methods and invalid terms', async () => {
    const f = fixture();
    f.config.paymentMethods = ['ENACH'];
    expect(await f.service.availability('client')).toMatchObject({
      reason: 'PACKAGE_UNAVAILABLE',
    });
    f.config.paymentMethods = ['UPI_AUTOPAY'];
    f.config.validityDays = 1.5;
    expect(await f.service.availability('client')).toMatchObject({
      reason: 'PACKAGE_TERMS_INVALID',
    });
    f.config.validityDays = 365;
    f.config.authorizationAmount = '20001';
    expect(await f.service.availability('client')).toMatchObject({
      reason: 'PACKAGE_TERMS_INVALID',
    });
    f.db.clientSubscription.findFirst.mockResolvedValue(null);
    expect(await f.service.availability('client')).toMatchObject({
      reason: 'PACKAGE_UNAVAILABLE',
    });
  });
  it('reads the unified policy, never the historical onboarding switch', async () => {
    const f = fixture();
    f.policy.enabled = false;
    expect(await f.service.availability('client')).toMatchObject({ enabled: false, effectiveEnabled: false });
    expect(f.db.walletAutoRechargePolicy.findUnique).toHaveBeenCalledWith({ where: { clientId: 'client' } });
  });
  it('does not enable onboarding outside the rollout allowlist', async () => {
    const f = fixture();
    f.settings.UNIFIED_AUTOPAY_CLIENT_IDS = 'other';
    expect(await f.service.availability('client')).toMatchObject({ effectiveEnabled: false });
  });
});
