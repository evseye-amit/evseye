import { afterAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RazorpayAutoPayProvider } from '../../../src/payments/razorpay/razorpay-autopay.provider.js';
import { RazorpayProviderError } from '../../../src/payments/razorpay/razorpay.client.js';
import { PaymentOrchestratorService } from '../../../src/payments/payment-orchestrator.service.js';
import { RiderPaymentsService } from '../../../src/rider-billing/rider-payments.service.js';
import { WalletService } from '../../../src/wallet/wallet.service.js';

const url = process.env.AUTOPAY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({
  datasources: {
    db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' },
  },
});
afterAll(() => db.$disconnect());
describe.skipIf(!url)(
  'Razorpay UPI AutoPay with PostgreSQL and a simulated gateway',
  () => {
    async function fixture() {
      const suffix = randomUUID().replaceAll('-', '');
      const client = await db.client.create({
        data: { name: 'AutoPay test', slug: suffix, status: 'ACTIVE' },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          name: 'Rider',
          mobile: suffix,
          status: 'ACTIVE',
        },
      });
      await db.riderPaymentProfile.create({
        data: { clientId: client.id, riderId: rider.id, autoPayEnabled: true },
      });
      const mandate = await db.paymentMandate.create({
        data: {
          clientId: client.id,
          riderId: rider.id,
          requestKey: suffix,
          provider: 'RAZORPAY',
          providerMandateId: `EVSEYE_${suffix}`,
          maxAmount: '2500',
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });
      const registration = {
        id: `inv_${suffix}`,
        receipt: mandate.id,
        customer_id: `cust_${suffix}`,
        order_id: `order_auth${suffix}`,
        payment_id: null as string | null,
        status: 'issued',
        amount: 100,
        currency: 'INR',
        short_url: 'https://rzp.io/test',
      };
      const authorization = {
        id: `pay_auth${suffix}`,
        order_id: registration.order_id,
        customer_id: registration.customer_id,
        token_id: `token_${suffix}`,
        amount: 100,
        currency: 'INR',
        method: 'upi',
        status: 'captured',
        captured: true,
        amount_refunded: 0,
      };
      const token = {
        id: authorization.token_id,
        method: 'upi',
        recurring: true,
        recurring_details: { status: 'confirmed' },
        max_amount: 250000,
      };
      const orders: Array<{
        id: string;
        receipt: string;
        amount: number;
        currency: string;
        status: string;
      }> = [];
      const payments: Array<typeof authorization> = [];
      const settings: Record<string, string> = {
        RAZORPAY_AUTOPAY_ENABLED: 'true',
        PAYMENT_PROVIDER: 'mock',
      };
      const config = {
        get: (key: string) => settings[key],
        getOrThrow: (key: string) => settings[key],
      };
      const gateway = {
        keyId: 'rzp_test_example',
        assertConfigured: vi.fn(),
        createRegistration: vi.fn(async () => registration),
        fetchRegistration: vi.fn(async () => registration),
        findRegistrations: vi.fn(async () => [registration]),
        recurringPayment: vi.fn(async (id: string) =>
          id === authorization.id
            ? authorization
            : payments.find((p) => p.id === id)!,
        ),
        fetchToken: vi.fn(async () => token),
        cancelToken: vi.fn(async () => ({ status: 'cancellation_initiated' })),
        cancelRegistration: vi.fn(),
        createDebitOrder: vi.fn(async (amount: number, receipt: string) => {
          const order = {
            id: `order_debit${orders.length}${suffix}`,
            receipt,
            amount,
            currency: 'INR',
            status: 'created',
          };
          orders.push(order);
          return order;
        }),
        findOrders: vi.fn(async (receipt: string) =>
          orders.filter((o) => o.receipt === receipt),
        ),
        recurringOrderPayments: vi.fn(async (id: string) =>
          payments.filter((p) => p.order_id === id),
        ),
        createRecurringPayment: vi.fn(
          async (input: { orderId: string; amount: number }) => {
            const payment = {
              ...authorization,
              id: `pay_debit${payments.length}${suffix}`,
              order_id: input.orderId,
              amount: input.amount,
              status: 'created',
              captured: false,
            };
            payments.push(payment);
            return { razorpay_payment_id: payment.id };
          },
        ),
      };
      const adapter = new RazorpayAutoPayProvider(
        db as never,
        gateway as never,
        config as never,
      );
      const wallet = new WalletService(db as never);
      const router = {
        forProvider: vi.fn((provider: string) => {
          expect(provider).toBe('RAZORPAY');
          return adapter;
        }),
      };
      const orchestrator = new PaymentOrchestratorService(
        db as never,
        config as never,
        {} as never,
        new RiderPaymentsService(db as never),
        wallet,
        router as never,
      );
      const input = {
        providerMandateId: mandate.providerMandateId,
        idempotencyKey: mandate.id,
        customer: {
          name: rider.name,
          phone: rider.mobile,
          email: 'rider@example.com',
        },
        planName: 'Test',
        mode: 'ON_DEMAND' as const,
        maxAmount: '2500',
        paymentMethods: ['UPI_AUTOPAY' as const],
        expiresAt: mandate.expiresAt.toISOString(),
      };
      async function active() {
        await adapter.createMandate(input);
        registration.payment_id = authorization.id;
        expect(
          (await adapter.fetchMandate(mandate.providerMandateId)).status,
        ).toBe('ACTIVE');
        await db.paymentMandate.update({
          where: { id: mandate.id },
          data: { status: 'ACTIVE', authorizedAt: new Date() },
        });
      }
      async function invoice() {
        const row = await db.riderInvoice.create({
          data: {
            clientId: client.id,
            riderId: rider.id,
            invoiceNumber: randomUUID(),
            invoiceType: 'RENTAL',
            status: 'DRAFT',
            billingPeriodStart: new Date('2026-01-01'),
            billingPeriodEnd: new Date('2026-01-02'),
            dueDate: new Date(),
            subtotal: '500',
            totalAmount: '500',
            outstandingAmount: '500',
            creditAmount: 0,
            currency: 'INR',
            lines: {
              create: {
                kind: 'CHARGE',
                sourceId: randomUUID(),
                description: 'Rent',
                amount: '500',
                currency: 'INR',
                chargeType: 'RENTAL',
              },
            },
          },
        });
        return db.riderInvoice.update({
          where: { id: row.id },
          data: { status: 'FINALIZED', issuedAt: new Date() },
        });
      }
      const schedule = () => new Date(Date.now() + 48 * 3600000).toISOString();
      return {
        client,
        rider,
        mandate,
        registration,
        authorization,
        token,
        gateway,
        adapter,
        orchestrator,
        input,
        active,
        invoice,
        schedule,
        orders,
        payments,
        settings,
      };
    }
    it('keeps nominal registration separate from business payments and requires authoritative token confirmation', async () => {
      const f = await fixture();
      expect((await f.adapter.createMandate(f.input)).status).toBe(
        'AUTHORIZATION_PENDING',
      );
      await f.adapter.createMandate(f.input);
      expect(f.gateway.createRegistration).toHaveBeenCalledTimes(1);
      f.registration.payment_id = f.authorization.id;
      f.token.recurring_details.status = 'initiated';
      expect(
        (await f.adapter.fetchMandate(f.mandate.providerMandateId)).status,
      ).toBe('AUTHORIZATION_PENDING');
      f.token.recurring_details.status = 'confirmed';
      expect(
        (await f.adapter.fetchMandate(f.mandate.providerMandateId)).status,
      ).toBe('ACTIVE');
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
    });
    it('rejects missing email and excessive limits before any provider request', async () => {
      const f = await fixture();
      expect(() =>
        f.adapter.assertMandateEligible(f.client.id, {
          ...f.input,
          customer: { ...f.input.customer, email: undefined },
        }),
      ).toThrow('email');
      expect(() =>
        f.adapter.assertMandateEligible(f.client.id, {
          ...f.input,
          maxAmount: '15000.01',
        }),
      ).toThrow('15,000');
      expect(() =>
        f.adapter.assertChargeEligible({
          amount: '500',
          currency: 'INR',
          scheduledAt: new Date(),
        }),
      ).toThrow('25 hours');
      expect(f.gateway.createRegistration).not.toHaveBeenCalled();
    });
    it('recovers an ambiguous registration without repeating its POST', async () => {
      const f = await fixture();
      f.gateway.createRegistration.mockRejectedValueOnce(
        new RazorpayProviderError(),
      );
      await expect(f.adapter.createMandate(f.input)).rejects.toThrow();
      await db.paymentMandate.update({
        where: { id: f.mandate.id },
        data: { providerCreateClaimedAt: new Date(Date.now() - 60000) },
      });
      expect(
        (await f.adapter.fetchMandate(f.mandate.providerMandateId)).status,
      ).toBe('AUTHORIZATION_PENDING');
      expect(f.gateway.createRegistration).toHaveBeenCalledTimes(1);
    });
    it('settles a captured debit exactly once, using the saved provider despite a different checkout default', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'collect-key-1',
        f.schedule(),
      );
      expect(debit.status).toBe('PENDING');
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      await Promise.all([
        f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId),
        f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId),
      ]);
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId);
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
        ).outstandingAmount.toFixed(2),
      ).toBe('0.00');
      expect(
        await db.razorpayAutoPayCapture.count({
          where: { transactionId: debit.paymentId, status: 'SETTLED' },
        }),
      ).toBe(1);
      expect(f.gateway.createDebitOrder).toHaveBeenCalledTimes(1);
      expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
    });
    it('recovers a lost debit response from the existing order without submitting another charge', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const original =
        f.gateway.createRecurringPayment.getMockImplementation()!;
      f.gateway.createRecurringPayment.mockImplementationOnce(async (input) => {
        await original(input);
        throw new RazorpayProviderError();
      });
      await expect(
        f.orchestrator.collect(
          f.client.id,
          f.rider.id,
          invoice.id,
          'uncertain-key-1',
          f.schedule(),
        ),
      ).rejects.toThrow('uncertain');
      const saved = await db.paymentTransaction.findFirstOrThrow({
        where: { clientId: f.client.id },
      });
      const debit = { paymentId: saved.id };
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      expect(
        (await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId))
          .status,
      ).toBe('SUCCESS');
      expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
    });
    it('does not claim bank cancellation until the provider confirms it', async () => {
      const f = await fixture();
      await f.active();
      const pending = await f.adapter.cancelMandate(
        f.mandate.providerMandateId,
        'cancel-key-1',
      );
      expect(pending.status).toBe('ACTIVE');
      expect(pending.rawStatus).toBe('CANCELLATION_PENDING');
      expect(
        (
          await db.paymentMandate.findUniqueOrThrow({
            where: { id: f.mandate.id },
          })
        ).autoDebitEnabled,
      ).toBe(false);
      f.token.recurring_details.status = 'cancelled';
      f.token.recurring = false;
      expect(
        (await f.adapter.fetchMandate(f.mandate.providerMandateId)).status,
      ).toBe('CANCELLED');
    });
    it('stops new debit creation after local disable but still reconciles captured payments when the rollout flag is off', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'disabled-key-1',
        f.schedule(),
      );
      f.settings.RAZORPAY_AUTOPAY_ENABLED = 'false';
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      expect(
        (await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId))
          .status,
      ).toBe('SUCCESS');
    });
    it('retains late captures as unallocated review funds if the invoice was voided', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'voided-key-1',
        f.schedule(),
      );
      await db.riderInvoice.update({
        where: { id: invoice.id },
        data: { status: 'VOID' },
      });
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId);
      const stored = await db.paymentTransaction.findUniqueOrThrow({
        where: { id: debit.paymentId },
      });
      expect(stored.failureCode).toBe('UNAPPLIED_PROVIDER_PAYMENT_REVIEW');
      expect(
        (
          await db.riderPayment.findUniqueOrThrow({
            where: { id: stored.riderPaymentId! },
          })
        ).unallocatedAmount.toFixed(2),
      ).toBe('500.00');
    });
    it('flags external refunds and duplicate captures without crediting twice', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'refund-key-1',
        f.schedule(),
      );
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId);
      f.payments[0].amount_refunded = 100;
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId);
      expect(
        (
          await db.paymentTransaction.findUniqueOrThrow({
            where: { id: debit.paymentId },
          })
        ).failureCode,
      ).toBe('EXTERNAL_REFUND_REQUIRES_REVIEW');
      f.payments.push({
        ...f.payments[0],
        id: `pay_extra${randomUUID().replaceAll('-', '')}`,
        amount_refunded: 0,
      });
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId);
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(1);
      expect(
        await db.razorpayAutoPayCapture.count({
          where: { transactionId: debit.paymentId, status: 'REVIEW_REQUIRED' },
        }),
      ).toBe(2);
    });
    it('does not schedule a notification or debit after local consent is disabled', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      await db.riderPaymentProfile.update({
        where: {
          clientId_riderId: { clientId: f.client.id, riderId: f.rider.id },
        },
        data: { autoPayEnabled: false },
      });
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'local-disable-key',
        f.schedule(),
      );
      expect(debit.status).toBe('CANCELLED');
      expect(f.gateway.createDebitOrder).not.toHaveBeenCalled();
      expect(f.gateway.createRecurringPayment).not.toHaveBeenCalled();
    });
    it('rejects a captured payment bound to another customer without posting money', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      const debit = await f.orchestrator.collect(
        f.client.id,
        f.rider.id,
        invoice.id,
        'mismatch-key-1',
        f.schedule(),
      );
      f.payments[0].status = 'captured';
      f.payments[0].captured = true;
      f.payments[0].customer_id = 'cust_foreign';
      await expect(
        f.orchestrator.verify(f.client.id, f.rider.id, debit.paymentId),
      ).rejects.toThrow('proof mismatch');
      expect(
        await db.riderPayment.count({ where: { clientId: f.client.id } }),
      ).toBe(0);
    });
    it('keeps a debit with an unknown empty gateway outcome unresolved without retrying', async () => {
      const f = await fixture();
      await f.active();
      const invoice = await f.invoice();
      f.gateway.createRecurringPayment.mockRejectedValueOnce(
        new RazorpayProviderError(),
      );
      await expect(
        f.orchestrator.collect(
          f.client.id,
          f.rider.id,
          invoice.id,
          'no-response-key',
          f.schedule(),
        ),
      ).rejects.toThrow('uncertain');
      const debit = await db.paymentTransaction.findFirstOrThrow({
        where: { clientId: f.client.id },
      });
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.id);
      await f.orchestrator.verify(f.client.id, f.rider.id, debit.id);
      expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
      expect(
        (
          await db.paymentTransaction.findUniqueOrThrow({
            where: { id: debit.id },
          })
        ).status,
      ).toBe('UNKNOWN');
    });
  },
);
