import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { AutoPayAvailabilityService } from '../../src/payments/autopay-availability.service.js';
import { PaymentGatewayPolicyService } from '../../src/payments/payment-gateway-policy.service.js';

const url = process.env.AUTOPAY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost:5432/unused',
);
afterAll(() => db.$disconnect());
const clients: string[] = [];
const config = { get: (key: string) => key === 'RAZORPAY_ENVIRONMENT' ? 'TEST' : key === 'UNIFIED_AUTOPAY_CLIENT_IDS' ? clients.join(',') : 'true' };
const service = new AutoPayAvailabilityService(
  db as never,
  config as never,
);
const gateway = new PaymentGatewayPolicyService(
  db as never,
  config as never,
  service,
);

async function fixture(environment = 'TEST', included = true) {
  const client = await db.client.create({
    data: { name: 'AutoPay policy test', slug: randomUUID(), status: 'ACTIVE' },
  });
  const actor = await db.user.create({
    data: {
      clientId: client.id,
      name: 'Client admin',
      mobile: randomUUID(),
      role: 'CLIENT_ADMIN',
    },
  });
  const feature = await db.feature.upsert({
    where: { code: 'RIDER_AUTO_PAY' },
    update: {},
    create: {
      code: 'RIDER_AUTO_PAY',
      name: 'Rider AutoPay',
      featureType: 'CONFIGURATION',
      billingUnit: 'RIDER',
      configuration: {
        mandateMaxAmount: '750',
        validityDays: 365,
        paymentMethods: ['UPI_AUTOPAY'],
      },
    },
  });
  const pack = await db.package.create({
    data: {
      code: randomUUID(),
      name: 'AutoPay package',
      features: { create: { featureId: feature.id, isIncluded: included } },
    },
  });
  await db.clientSubscription.create({
    data: {
      clientId: client.id,
      packageId: pack.id,
      billingCycle: 'MONTHLY',
      startDate: new Date('2020-01-01'),
    },
  });
  const merchant = await db.clientPaymentProvider.create({
    data: {
      clientId: client.id,
      provider: 'RAZORPAY',
      environment,
      keyId: 'rzp_test_policy',
      secretReference: 'env:TEST_MERCHANT',
      status: 'ACTIVE',
    },
  });
  await db.paymentProviderConfigurationVersion.create({
    data: {
      clientId: client.id,
      providerConfigurationId: merchant.id,
      version: 1,
      provider: 'RAZORPAY',
      environment,
      keyId: merchant.keyId,
      secretReference: merchant.secretReference,
      credentialFingerprint: 'test-fingerprint',
    },
  });
  clients.push(client.id);
  return { client, actor };
}

describe.skipIf(!url)('Unified onboarding availability with PostgreSQL', () => {
  it('uses only wallet policy and isolates clients', async () => {
    const a = await fixture(), b = await fixture();
    await db.clientDeploymentAutoPayPolicy.create({ data: { clientId: b.client.id, enabled: true } });
    expect(await service.availability(b.client.id)).toMatchObject({ enabled: false, effectiveEnabled: false });
    await db.walletAutoRechargePolicy.create({ data: { clientId: a.client.id, enabled: true } });
    expect((await gateway.capabilities(a.client.id)).autoPay.supported).toBe(true);
    expect((await gateway.capabilities(b.client.id)).autoPay.supported).toBe(false);
    await db.walletAutoRechargePolicy.update({ where: { clientId: a.client.id }, data: { enabled: false } });
    expect((await gateway.capabilities(a.client.id)).autoPay.supported).toBe(false);
  });
  it('keeps provider/package prerequisites and mandate limits enforced', async () => {
    const missingPackage = await fixture('TEST', false), wrongEnvironment = await fixture('PRODUCTION'), inadequate = await fixture();
    for (const f of [missingPackage, wrongEnvironment, inadequate]) await db.walletAutoRechargePolicy.create({ data: { clientId: f.client.id, enabled: true, rechargeAmount: '1000.00' } });
    expect(await service.availability(missingPackage.client.id)).toMatchObject({ effectiveEnabled: false, reason: 'PACKAGE_UNAVAILABLE' });
    expect(await service.availability(wrongEnvironment.client.id)).toMatchObject({ effectiveEnabled: false, reason: 'MERCHANT_UNAVAILABLE' });
    expect(await service.availability(inadequate.client.id)).toMatchObject({ effectiveEnabled: false, reason: 'PACKAGE_TERMS_INVALID' });
  });
});
