import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { DeploymentAutoPayPolicyService } from '../../src/payments/deployment-autopay-policy.service.js';
import { PaymentGatewayPolicyService } from '../../src/payments/payment-gateway-policy.service.js';

const url = process.env.AUTOPAY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost:5432/unused',
);
afterAll(() => db.$disconnect());
const config = {
  get: (key: string) => (key === 'RAZORPAY_ENVIRONMENT' ? 'TEST' : 'true'),
};
const service = new DeploymentAutoPayPolicyService(
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
  return { client, actor };
}

describe.skipIf(!url)('Onboarding AutoPay policy with PostgreSQL', () => {
  it('backfills eligible existing TEST clients, leaving production and ineligible clients off', async () => {
    const eligible = await fixture(),
      production = await fixture('PRODUCTION'),
      ineligible = await fixture('TEST', false);
    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261121000000_client_deployment_autopay_policy/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const backfill = sql
      .slice(
        sql.indexOf('INSERT INTO "ClientDeploymentAutoPayPolicy"'),
        sql.indexOf('INSERT INTO "AuditLog"'),
      )
      .trim();
    await db.$executeRawUnsafe(
      backfill.replace(/;\s*$/, ' AND c.id = ANY($1::text[]);'),
      [eligible.client.id, production.client.id, ineligible.client.id],
    );
    expect(await service.get(eligible.client.id)).toMatchObject({
      enabled: true,
      effectiveEnabled: true,
      revision: 1,
    });
    expect(await service.get(production.client.id)).toMatchObject({
      enabled: false,
    });
    expect(await service.get(ineligible.client.id)).toMatchObject({
      enabled: false,
    });
  });
  it('isolates preferences and history, and keeps separate UPI AutoPay available', async () => {
    const a = await fixture(),
      b = await fixture();
    expect(await service.get(a.client.id)).toMatchObject({
      enabled: false,
      canEnable: true,
      revision: 0,
    });
    await service.set(a.client.id, a.actor.id, { enabled: true, revision: 0 });
    expect(
      (await gateway.capabilities(a.client.id)).purposes.DEPLOYMENT
        .autoPaySetup,
    ).toBe(true);
    expect(
      (await gateway.capabilities(b.client.id)).purposes.DEPLOYMENT
        .autoPaySetup,
    ).toBe(false);
    await service.set(a.client.id, a.actor.id, { enabled: false, revision: 1 });
    const caps = await gateway.capabilities(a.client.id);
    expect(caps.purposes.DEPLOYMENT).toMatchObject({
      enabled: true,
      autoPaySetup: false,
    });
    expect(caps.purposes.UPI_AUTOPAY.enabled).toBe(true);
    expect((await service.history(a.client.id, 1)).items).toHaveLength(2);
    expect((await service.history(b.client.id, 1)).items).toHaveLength(0);
    expect(await service.get(a.client.id)).toMatchObject({
      updatedByName: 'Client admin',
      revision: 2,
    });
  });
  it('allows only one concurrent save with the same revision', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      service.set(f.client.id, f.actor.id, { enabled: true, revision: 0 }),
      service.set(f.client.id, f.actor.id, { enabled: true, revision: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await service.history(f.client.id, 1)).items).toHaveLength(1);
  });
  it('rolls back the policy when its audit write fails', async () => {
    const f = await fixture();
    await expect(
      service.set(f.client.id, randomUUID(), { enabled: true, revision: 0 }),
    ).rejects.toThrow();
    expect(await service.get(f.client.id)).toMatchObject({
      enabled: false,
      revision: 0,
    });
    expect((await service.history(f.client.id, 1)).items).toHaveLength(0);
  });
});
