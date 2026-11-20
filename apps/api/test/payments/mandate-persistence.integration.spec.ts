import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { MandateService } from '../../src/payments/mandate.service.js';
import { ProviderRequestError } from '../../src/payments/payment-provider.interface.js';

const url = process.env.AUTOPAY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());

describe.skipIf(!url)('AutoPay mandate event persistence', () => {
  it.each(['success', 'rejected', 'uncertain'] as const)(
    'persists tenant-scoped events when provider creation is %s',
    async (outcome) => {
      const client = await db.client.create({
        data: { name: 'Mandate persistence test', slug: randomUUID(), status: 'ACTIVE' },
      });
      const rider = await db.rider.create({
        data: { clientId: client.id, name: 'Test rider', mobile: randomUUID(), status: 'ACTIVE' },
      });
      const provider = {
        createMandate: vi.fn(async ({ providerMandateId }: { providerMandateId: string }) => {
          if (outcome === 'rejected') throw new ProviderRequestError('INVALID_REQUEST');
          if (outcome === 'uncertain') throw new Error('Provider timeout');
          return { providerMandateId, status: 'AUTHORIZATION_PENDING', rawStatus: 'PENDING' };
        }),
      };
      const service = new MandateService(db as never, {
        getOrThrow: () => 'razorpay',
      } as never, provider as never, {} as never);
      // Keep package eligibility out of this persistence regression; all mandate,
      // event, profile and audit writes use the real Prisma client and PostgreSQL.
      vi.spyOn(service as any, 'context').mockResolvedValue({
        rider, subscription: { package: { name: 'Test package' } },
        maxAmount: new Prisma.Decimal('750'), validityDays: 365,
        authorizationAmount: new Prisma.Decimal('1'),
      });
      const requestKey = randomUUID();
      const creation = service.create(client.id, randomUUID(), requestKey);
      if (outcome === 'success') await creation;
      else await expect(creation).rejects.toThrow(
        outcome === 'rejected' ? 'provider rejected' : 'creation is uncertain',
      );
      const saved = await db.paymentMandate.findUniqueOrThrow({
        where: { clientId_riderId_requestKey: { clientId: client.id, riderId: rider.id, requestKey } },
        include: { events: true },
      });
      const status = outcome === 'success' ? 'AUTHORIZATION_PENDING' : outcome === 'rejected' ? 'FAILED' : 'UNKNOWN';
      expect(saved.status).toBe(status);
      expect(provider.createMandate).toHaveBeenCalledOnce();
      expect(saved.events).toHaveLength(2);
      expect(saved.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ clientId: client.id, mandateId: saved.id, toStatus: 'CREATING', source: 'RIDER_REQUEST' }),
        expect.objectContaining({ clientId: client.id, mandateId: saved.id, fromStatus: 'CREATING', toStatus: status, source: outcome === 'success' ? 'CREATE' : 'CREATE_ERROR' }),
      ]));
      expect(await db.paymentMandateEvent.count({ where: { mandateId: saved.id, clientId: { not: client.id } } })).toBe(0);
    },
  );
});
