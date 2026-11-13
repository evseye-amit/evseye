import { PaymentRefundService } from '../../src/payments/payment-refund.service.js';
import { RazorpayRefundService } from '../../src/payments/razorpay/razorpay-refund.service.js';
import { RiderPaymentsService } from '../../src/rider-billing/rider-payments.service.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import { randomUUID, createHmac } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { RazorpayConfigurationService } from '../../src/payments/razorpay/razorpay-configuration.service.js';
import { CashfreePaymentProvider } from '../../src/payments/cashfree/cashfree-payment.provider.js';
import { CashfreeHttpClient } from '../../src/payments/cashfree/cashfree-http.client.js';
import { CheckoutCollectionService } from '../../src/payments/checkout-collection.service.js';
import { ProviderSettlementService } from '../../src/payments/provider-settlement.service.js';
import { PaymentAlertService } from '../../src/payments/payment-alert.service.js';
const url = process.env.PAYMENT_CONFIGURATION_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Disposable test database required.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost/unused',
);
afterAll(() => db.$disconnect());
async function client() {
  const c = await db.client.create({
    data: { name: 'Phase7', slug: randomUUID(), status: 'ACTIVE' },
  });
  const actor = await db.user.create({
    data: {
      clientId: c.id,
      name: 'Admin',
      mobile: randomUUID(),
      role: 'CLIENT_ADMIN',
    },
  });
  const rider = await db.rider.create({
    data: { clientId: c.id, name: 'Rider', mobile: randomUUID() },
  });
  return { c, actor, rider };
}
describe.skipIf(!url)(
  'Phase 7 merchant isolation and financial evidence',
  () => {
    it('keeps Cashfree checkout webhooks bound to their original tenant and credential version', async () => {
      const a = await client(),
        b = await client();
      const config = new ConfigService({
        PAYMENT_PROVIDER: 'disabled',
        CASHFREE_ENVIRONMENT: 'SANDBOX',
        CASHFREE_API_VERSION: '2025-01-01',
        CLIENT_A_V1: JSON.stringify({
          keySecret: 'secret-a',
          webhookSecret: 'hook-a',
        }),
        CLIENT_A_V2: JSON.stringify({
          keySecret: 'rotated-a',
          webhookSecret: 'hook-new',
        }),
        CLIENT_B_V1: JSON.stringify({
          keySecret: 'secret-b',
          webhookSecret: 'hook-b',
        }),
      });
      const configurations = new RazorpayConfigurationService(
        db as never,
        config,
      );
      const av1 = await configurations.save(
        a.c.id,
        {
          provider: 'CASHFREE',
          environment: 'TEST',
          keyId: 'merchant_a',
          secretReference: 'env:CLIENT_A_V1',
        },
        a.actor.id,
      );
      await configurations.save(
        b.c.id,
        {
          provider: 'CASHFREE',
          environment: 'TEST',
          keyId: 'merchant_b',
          secretReference: 'env:CLIENT_B_V1',
        },
        b.actor.id,
      );
      const collection = await db.paymentCollectionRequest.create({
        data: {
          clientId: a.c.id,
          riderId: a.rider.id,
          provider: 'CASHFREE',
          configurationVersionId: av1.configurationVersionId,
          collectionType: 'INVOICE_PAYMENT',
          method: 'UPI',
          status: 'PENDING',
          amount: '10',
          currency: 'INR',
          idempotencyKey: randomUUID(),
          providerOrderId: `cf_${randomUUID()}`,
        },
      });
      await configurations.save(
        a.c.id,
        {
          provider: 'CASHFREE',
          environment: 'TEST',
          keyId: 'merchant_a2',
          secretReference: 'env:CLIENT_A_V2',
        },
        a.actor.id,
      );
      const gateway = new CashfreePaymentProvider(
        new CashfreeHttpClient(config as never),
        config as never,
        configurations,
      );
      const service = new CheckoutCollectionService(
        db as never,
        config as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        gateway,
      );
      const verify = vi
        .spyOn(service, 'verify')
        .mockResolvedValue({ status: 'SUCCESS' } as never);
      const raw = Buffer.from(
          JSON.stringify({
            type: 'PAYMENT_SUCCESS_WEBHOOK',
            data: { order: { order_id: collection.providerOrderId } },
          }),
        ),
        time = '1234';
      const sign = (secret: string) =>
        createHmac('sha256', secret).update(time).update(raw).digest('base64');
      await expect(
        service.webhook(raw, time, sign('secret-b')),
      ).rejects.toThrow();
      await expect(
        service.webhook(raw, time, sign('rotated-a')),
      ).rejects.toThrow();
      expect(verify).not.toHaveBeenCalled();
      expect(
        await db.paymentProviderEvent.count({
          where: { collectionRequestId: collection.id },
        }),
      ).toBe(0);
      await service.webhook(raw, time, sign('secret-a'));
      expect(verify).toHaveBeenCalledWith(a.c.id, a.rider.id, collection.id);
      await expect(
        configurations.resolveVersion(
          b.c.id,
          av1.configurationVersionId,
          'CASHFREE',
        ),
      ).rejects.toThrow();
      await expect(
        db.paymentCollectionRequest.update({
          where: { id: collection.id },
          data: { configurationVersionId: null },
        }),
      ).rejects.toThrow();
    });
    it('records immutable, tenant-scoped bank evidence once without posting rider payments', async () => {
      const a = await client(),
        b = await client(),
        service = new ProviderSettlementService(db as never);
      const id = randomUUID(),
        utr = `BANK${randomUUID().replaceAll('-', '')}`;
      const report = await service.importReport(a.c.id, a.actor.id, {
        provider: 'RAZORPAY',
        providerSettlementId: id,
        currency: 'INR',
        grossAmount: '100',
        refundAmount: '0',
        feeAmount: '0',
        taxAmount: '0',
        netAmount: '100',
        settledAt: '2026-01-01T00:00:00Z',
        utr,
        items: [
          { kind: 'PAYMENT', amount: '100', providerReference: `pay_${id}` },
        ],
      });
      const evidence = {
        amount: '100',
        currency: 'INR',
        utr,
        creditedAt: '2026-01-01',
        accountLast4: '1234',
        evidenceReference: 'statement:line:123',
      };
      await expect(
        service.confirmBank(b.c.id, report.id, b.actor.id, evidence),
      ).rejects.toThrow('SETTLEMENT_NOT_FOUND');
      await expect(
        service.confirmBank(a.c.id, report.id, a.actor.id, {
          ...evidence,
          amount: '99',
        }),
      ).rejects.toThrow('BANK_RECEIPT_MISMATCH');
      await Promise.all([
        service.confirmBank(a.c.id, report.id, a.actor.id, evidence),
        service.confirmBank(a.c.id, report.id, a.actor.id, evidence),
      ]);
      expect(
        await db.auditLog.count({
          where: { entityId: report.id, action: 'SETTLEMENT_BANK_CONFIRMED' },
        }),
      ).toBe(1);
      await expect(
        service.confirmBank(a.c.id, report.id, a.actor.id, {
          ...evidence,
          evidenceReference: 'different:statement',
        }),
      ).rejects.toThrow('IMMUTABLE');
      expect(await db.riderPayment.count({ where: { clientId: a.c.id } })).toBe(
        0,
      );
      expect(
        (await service.rematch(a.c.id, report.id, a.actor.id)).bankConfirmedAt,
      ).not.toBeNull();
    });
    it('deduplicates alerts and rejects routing to another workspace', async () => {
      const a = await client(),
        b = await client(),
        alerts = new PaymentAlertService(db as never, {} as never),
        reference = randomUUID();
      const [one, two] = await Promise.all([
        alerts.raise(a.c.id, 'AGED_REFUND', reference),
        alerts.raise(a.c.id, 'AGED_REFUND', reference),
      ]);
      expect(one.id).toBe(two.id);
      await expect(
        alerts.route(a.c.id, one.id, a.actor.id, b.actor.id, true),
      ).rejects.toThrow('WORKSPACE_ADMIN');
      await expect(
        alerts.route(b.c.id, one.id, b.actor.id, null, true),
      ).rejects.toThrow('NOT_FOUND');
      expect(
        (await alerts.route(a.c.id, one.id, a.actor.id, a.actor.id, true))
          .acknowledgedAt,
      ).not.toBeNull();
    });
    it('adopts a verified external refund once without issuing another gateway refund', async () => {
      const a = await client(),
        suffix = randomUUID().replaceAll('-', '');
      const configurations = new RazorpayConfigurationService(
        db as never,
        new ConfigService({
          EXTERNAL_REFUND_V1: JSON.stringify({
            keySecret: 'secret',
            webhookSecret: 'hook',
          }),
        }),
      );
      const version = await configurations.save(
        a.c.id,
        {
          provider: 'RAZORPAY',
          environment: 'TEST',
          keyId: 'rzp_test_example',
          secretReference: 'env:EXTERNAL_REFUND_V1',
        },
        a.actor.id,
      );
      const payment = await db.riderPayment.create({
        data: {
          clientId: a.c.id,
          riderId: a.rider.id,
          amount: '100',
          unallocatedAmount: '100',
          currency: 'INR',
          method: 'UPI',
          idempotencyKey: randomUUID(),
          receivedAt: new Date(),
          createdById: a.actor.id,
        },
      });
      await db.paymentCollectionRequest.create({
        data: {
          clientId: a.c.id,
          riderId: a.rider.id,
          riderPaymentId: payment.id,
          collectionType: 'INVOICE_PAYMENT',
          method: 'UPI',
          provider: 'RAZORPAY',
          status: 'SUCCESS',
          amount: '100',
          currency: 'INR',
          idempotencyKey: randomUUID(),
          providerPaymentId: `pay_${suffix}`,
          providerOrderId: `order_${suffix}`,
          razorpayPenaltyOrder: {
            create: {
              keyId: 'rzp_test_example',
              configurationVersionId: version.configurationVersionId,
              amountPaise: 10000n,
              currency: 'INR',
              status: 'OPEN',
            },
          },
        },
      });
      const wallets = new WalletService(db as never),
        wallet = await wallets.ensure(a.c.id, a.rider.id, a.actor.id);
      const accounts = await db.walletAccount.findMany({
        where: { walletId: wallet.id },
      });
      await wallets.post({
        clientId: a.c.id,
        walletId: wallet.id,
        actorId: a.actor.id,
        type: 'PAYMENT',
        amount: '100.00',
        currency: 'INR',
        description: 'Original payment',
        idempotencyKey: randomUUID(),
        entries: [
          {
            accountId: accounts.find((v) => v.accountType === 'CLEARING')!.id,
            entryType: 'DEBIT',
            amount: '100.00',
          },
          {
            accountId: accounts.find(
              (v) => v.accountType === 'PROVIDER_CLEARING',
            )!.id,
            entryType: 'CREDIT',
            amount: '100.00',
          },
        ],
      });
      const gateway = {
        fetchPayment: vi
          .fn()
          .mockResolvedValue({
            id: `pay_${suffix}`,
            order_id: `order_${suffix}`,
            amount: 10000,
            amount_refunded: 10000,
            currency: 'INR',
            captured: true,
            status: 'refunded',
          }),
        fetchRefund: vi
          .fn()
          .mockResolvedValue({
            id: `rfnd_${suffix}`,
            payment_id: `pay_${suffix}`,
            amount: 10000,
            status: 'processed',
            receipt: 'external-dashboard',
          }),
        createPaymentRefund: vi.fn(),
      };
      const service = new PaymentRefundService(
        db as never,
        {} as never,
        new RiderPaymentsService(db as never),
        undefined,
        new RazorpayRefundService(gateway as never),
        undefined,
        undefined,
        wallets,
      );
      const adopted = await service.adoptExternal(
        a.c.id,
        a.rider.id,
        payment.id,
        a.actor.id,
        `rfnd_${suffix}`,
        'Externally issued return',
        'UNALLOCATED_RETURN',
      );
      expect(adopted.status).toBe('SUCCESS');
      const repeated = await service.adoptExternal(
        a.c.id,
        a.rider.id,
        payment.id,
        a.actor.id,
        `rfnd_${suffix}`,
        'Externally issued return',
        'UNALLOCATED_RETURN',
      );
      expect(repeated.refundId).toBe(adopted.refundId);
      expect(gateway.createPaymentRefund).not.toHaveBeenCalled();
      expect(
        await db.paymentRefund.count({
          where: { clientId: a.c.id, paymentId: payment.id },
        }),
      ).toBe(1);
      expect(
        (
          await db.riderPayment.findUniqueOrThrow({ where: { id: payment.id } })
        ).refundedAmount.toFixed(2),
      ).toBe('100.00');
    });
  },
);
