import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../helpers/prisma-client.js';
import { RazorpayConfigurationService } from '../../../src/payments/razorpay/razorpay-configuration.service.js';

const url = process.env.PAYMENT_CONFIGURATION_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());
describe.skipIf(!url)('Merchant configuration rotation', () => {
  it('keeps old credentials accessible after rotation and disable, and rejects mutated retained secrets', async () => {
    const client = await db.client.create({ data: { name: 'Rotation test', slug: randomUUID(), status: 'ACTIVE' } });
    const actor = await db.user.create({ data: { clientId: client.id, name: 'Actor', mobile: randomUUID(), role: 'RIDER' } });
    const settings: Record<string, string> = {
      RAZORPAY_ENVIRONMENT: 'TEST',
      MERCHANT_V1: JSON.stringify({ keySecret: 'secret1', webhookSecret: 'hook1' }),
      MERCHANT_V2: JSON.stringify({ keySecret: 'secret2', webhookSecret: 'hook2' }),
    };
    const service = new RazorpayConfigurationService(db as never, { get: (key: string) => settings[key] } as never);
    const first = await service.save(client.id, { provider: 'RAZORPAY', environment: 'TEST', keyId: 'rzp_test_old', secretReference: 'env:MERCHANT_V1' }, actor.id);
    const second = await service.save(client.id, { provider: 'RAZORPAY', environment: 'TEST', keyId: 'rzp_test_new', secretReference: 'env:MERCHANT_V2' }, actor.id);
    expect(second.configurationVersionId).not.toBe(first.configurationVersionId);
    await expect(service.resolve(client.id)).resolves.toMatchObject({ keyId: 'rzp_test_new', configurationVersionId: second.configurationVersionId });
    await expect(service.resolveVersion(client.id, first.configurationVersionId)).resolves.toMatchObject({ keyId: 'rzp_test_old', keySecret: 'secret1' });
    await service.save(client.id, { provider: 'RAZORPAY', environment: 'TEST', keyId: 'rzp_test_new', secretReference: 'env:MERCHANT_V2', status: 'DISABLED' }, actor.id);
    await expect(service.resolve(client.id)).rejects.toThrow('unavailable');
    await expect(service.resolveVersion(client.id, first.configurationVersionId)).resolves.toMatchObject({ keySecret: 'secret1' });
    await expect(service.resolveVersion('another-client', first.configurationVersionId)).rejects.toThrow('unavailable');
    settings.MERCHANT_V1 = JSON.stringify({ keySecret: 'changed', webhookSecret: 'hook1' });
    await expect(service.resolveVersion(client.id, first.configurationVersionId)).rejects.toMatchObject({ response: { code: 'RAZORPAY_SECRET_VERSION_CHANGED' } });
  });
});
