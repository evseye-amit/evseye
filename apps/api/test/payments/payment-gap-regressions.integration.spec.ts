import { readFile } from 'node:fs/promises';
import { PaymentOrchestratorService } from '../../src/payments/payment-orchestrator.service.js';
import { AutoCollectionService } from '../../src/payments/auto-collection.service.js';
import { WalletBillingService } from '../../src/wallet/wallet-billing.service.js';
import { ProviderRequestError } from '../../src/payments/payment-provider.interface.js';
import { RiderDepositService } from '../../src/rider-deposits/deposit.service.js';
import { SecurityDepositService } from '../../src/wallet/security-deposit.service.js';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { RazorpayPenaltyService } from '../../src/payments/razorpay/razorpay-penalty.service.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CheckoutCollectionService } from '../../src/payments/checkout-collection.service.js';
import { RiderPaymentsService } from '../../src/rider-billing/rider-payments.service.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import { SubmissionPenaltyService } from '../../src/submission-penalties/submission-penalty.service.js';

const url = process.env.PENALTY_PAYMENT_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost:5432/unused',
);
afterAll(() => db.$disconnect());
describe.skipIf(!url)(
  'payment recovery and accounting regressions in PostgreSQL',
  () => {
    async function fixture() {
      const id = randomUUID();
      const client = await db.client.create({
        data: { name: 'Penalty checkout test', slug: id, status: 'ACTIVE' },
      });
      const user = await db.user.create({
        data: { clientId: client.id, name: 'Rider', mobile: id, role: 'RIDER' },
      });
      const rider = await db.rider.create({
        data: {
          clientId: client.id,
          userId: user.id,
          name: 'Rider',
          mobile: id,
          status: 'ACTIVE',
        },
      });
      const wallet = new WalletService(db as never);
      const providerResults: Array<{
        orderId: string;
        providerPaymentId: string;
        status: string;
        rawStatus: string;
        amount: string;
        currency: string;
      }> = [];
      const provider = {
        createCheckoutOrder: vi.fn(
          async ({ orderId }: { orderId: string }) => ({
            orderId,
            paymentSessionId: 'test-session',
            rawStatus: 'ACTIVE',
          }),
        ),
        fetchCheckoutPayments: vi.fn(async (orderId: string) =>
          providerResults.filter((result) => result.orderId === orderId),
        ),
        fetchCheckoutOrder: vi.fn(async (orderId: string) => ({
          orderId,
          status: 'ACTIVE',
        })),
      };
      const checkout = new CheckoutCollectionService(
        db as never,
        { getOrThrow: () => 'mock', get: () => undefined } as never,
        provider as never,
        new RiderPaymentsService(db as never),
        {} as never,
        {} as never,
        wallet,
        {} as never,
      );
      const penalties = new SubmissionPenaltyService(db as never);
      async function invoice(
        amount: string,
        type = 'SUBMISSION_PENALTY',
        dueDate = '2026-01-01',
      ) {
        const invoice = await db.riderInvoice.create({
          data: {
            clientId: client.id,
            riderId: rider.id,
            invoiceNumber: randomUUID(),
            invoiceType: type,
            billingPeriodStart: new Date('2026-01-01'),
            billingPeriodEnd: new Date('2026-01-02'),
            dueDate: new Date(dueDate),
            subtotal: amount,
            creditAmount: 0,
            totalAmount: amount,
            outstandingAmount: amount,
            currency: 'INR',
            lines: {
              create: {
                kind: 'CHARGE',
                sourceId: randomUUID(),
                description: 'Test penalty',
                amount,
                currency: 'INR',
                chargeType: 'RETURN_PENALTY',
              },
            },
          },
        });
        if (type === 'SUBMISSION_PENALTY')
          await db.riderCharge.create({
            data: {
              clientId: client.id,
              riderId: rider.id,
              invoiceId: invoice.id,
              sourceKey: randomUUID(),
              chargeType: 'RETURN_PENALTY',
              description: 'Test penalty',
              quantity: 1,
              unitAmount: amount,
              amount,
              currency: 'INR',
              status: 'INVOICED',
            },
          });
        return db.riderInvoice.update({
          where: { id: invoice.id },
          data: { status: 'FINALIZED', finalizedAt: new Date() },
        });
      }
      const older = await invoice('300');
      const newer = await invoice('900', 'SUBMISSION_PENALTY', '2026-01-02');
      const rental = await invoice('100', 'RENTAL', '2025-01-01');
      function success(orderId: string, amount: string) {
        providerResults.push({
          orderId,
          amount,
          providerPaymentId: `test-${randomUUID()}`,
          currency: 'INR',
          status: 'SUCCESS',
          rawStatus: 'SUCCESS',
        });
      }
      return {
        client,
        user,
        rider,
        older,
        newer,
        rental,
        invoice,
        checkout,
        wallet,
        penalties,
        provider,
        success,
      };
    }
    function razorpay(f: Awaited<ReturnType<typeof fixture>>) {
      const orders = new Map<string, any>();
      const captures = new Map<string, any>();
      const gateway = {
        keyId: 'rzp_test_penalty',
        keyIdFor: vi.fn().mockResolvedValue('rzp_test_client_penalty'),
        configurationFor: vi
          .fn()
          .mockResolvedValue({
            keyId: 'rzp_test_client_penalty',
            environment: 'TEST',
          }),
        enabled: true,
        verifyWebhook: vi.fn(),
        assertConfigured: vi.fn(),
        verifyCheckout: vi.fn(),
        createOrder: vi.fn(
          async (amount: number, currency: string, receipt: string) => {
            const order = {
              id: `order_${randomUUID().replaceAll('-', '')}`,
              amount,
              currency,
              receipt,
              status: 'created',
            };
            orders.set(order.id, order);
            return order;
          },
        ),
        fetchOrder: vi.fn(async (id: string) => orders.get(id)),
        findOrders: vi.fn(async (receipt: string) =>
          [...orders.values()].filter((o) => o.receipt === receipt),
        ),
        fetchPayment: vi.fn(async (id: string) => captures.get(id)),
        orderPayments: vi.fn(async (id: string) =>
          [...captures.values()].filter((p) => p.order_id === id),
        ),
      };
      const penalties = {
        rider: f.penalties.rider.bind(f.penalties),
        summary: f.penalties.summary.bind(f.penalties),
      };
      const service = new RazorpayPenaltyService(
        db as never,
        gateway as never,
        new RiderPaymentsService(db as never),
        f.wallet,
        penalties as never,
        undefined,
        new RiderDepositService(db as never),
        new SecurityDepositService(db as never, f.wallet, {} as never),
      );
      function capture(
        order: { orderId: string | null; amount: number; currency: string },
        extra = {},
      ) {
        const payment = {
          id: `pay_${randomUUID().replaceAll('-', '')}`,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          status: 'captured',
          captured: true,
          amount_refunded: 0,
          ...extra,
        };
        captures.set(payment.id, payment);
        return {
          razorpayOrderId: order.orderId!,
          razorpayPaymentId: payment.id,
          razorpaySignature: 'a'.repeat(64),
        };
      }
      return { service, gateway, capture, captures };
    }
    function genericCheckout(
      f: Awaited<ReturnType<typeof fixture>>,
      r: ReturnType<typeof razorpay>,
    ) {
      return new CheckoutCollectionService(
        db as never,
        { getOrThrow: () => 'razorpay', get: () => undefined } as never,
        {} as never,
        new RiderPaymentsService(db as never),
        new RiderDepositService(db as never),
        {} as never,
        f.wallet,
        new SecurityDepositService(db as never, f.wallet, {} as never),
        r.service,
      );
    }

    function cashfree(f: Awaited<ReturnType<typeof fixture>>) {
      const deposits = new SecurityDepositService(
        db as never,
        f.wallet,
        {} as never,
      );
      return new CheckoutCollectionService(
        db as never,
        {
          getOrThrow: (key: string) =>
            key === 'CASHFREE_ENVIRONMENT' ? 'SANDBOX' : 'cashfree',
          get: () => undefined,
        } as never,
        f.provider as never,
        new RiderPaymentsService(db as never),
        new RiderDepositService(db as never),
        new WalletBillingService(db as never, f.wallet, deposits),
        f.wallet,
        deposits,
      );
    }
    it('blocks wallet settlement while a Cashfree invoice order is payable', async () => {
      const f = await fixture(),
        service = cashfree(f);
      const pending = await service.payInvoice(
        f.client.id,
        f.rider.id,
        f.rental.id,
        randomUUID(),
        false,
        f.user.id,
      );
      const recharge = await service.payTopUp(
        f.client.id,
        f.rider.id,
        randomUUID(),
        '500.00',
      );
      f.success(recharge.orderId!, '500.00');
      await service.verify(f.client.id, f.rider.id, recharge.collectionId);
      await expect(
        service.payInvoice(
          f.client.id,
          f.rider.id,
          f.rental.id,
          randomUUID(),
          true,
          f.user.id,
        ),
      ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
      const billing = new WalletBillingService(
        db as never,
        f.wallet,
        new SecurityDepositService(db as never, f.wallet, {} as never),
      );
      await expect(
        billing.settle(f.client.id, f.rental.id, f.user.id, randomUUID()),
      ).rejects.toThrow('PAYMENT_ALREADY_IN_PROGRESS');
      const wallet = await f.wallet.ensure(f.client.id, f.rider.id, 'SYSTEM');
      expect(
        (await f.wallet.balance(f.client.id, wallet.id)).cash.totalBalance,
      ).toBe('500.00');
      f.success(pending.orderId!, '100.00');
      expect(
        await service.verify(f.client.id, f.rider.id, pending.collectionId!),
      ).toMatchObject({ status: 'SUCCESS', failureCode: null });
    });
    it('rolls back wallet funding when the external remainder is below minimum, and replays wallet-only payment', async () => {
      const f = await fixture(),
        service = cashfree(f);
      const recharge = await service.payTopUp(
        f.client.id,
        f.rider.id,
        randomUUID(),
        '500.00',
      );
      f.success(recharge.orderId!, '500.00');
      await service.verify(f.client.id, f.rider.id, recharge.collectionId);
      const invoice = await f.invoice('500.50', 'ONBOARDING');
      const r = razorpay(f),
        deposits = new SecurityDepositService(
          db as never,
          f.wallet,
          {} as never,
        );
      const online = new CheckoutCollectionService(
        db as never,
        { getOrThrow: () => 'razorpay', get: () => undefined } as never,
        {} as never,
        new RiderPaymentsService(db as never),
        new RiderDepositService(db as never),
        new WalletBillingService(db as never, f.wallet, deposits),
        f.wallet,
        deposits,
        r.service,
      );

      await expect(
        online.payInvoice(
          f.client.id,
          f.rider.id,
          invoice.id,
          randomUUID(),
          true,
          f.user.id,
        ),
      ).rejects.toThrow();
      expect(
        (
          await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })
        ).paidAmount.toFixed(2),
      ).toBe('0.00');
      const key = randomUUID();
      expect(
        await service.payInvoice(
          f.client.id,
          f.rider.id,
          f.rental.id,
          key,
          true,
          f.user.id,
        ),
      ).toMatchObject({ status: 'PAID', collectionId: null });
      expect(
        await service.payInvoice(
          f.client.id,
          f.rider.id,
          f.rental.id,
          key,
          true,
          f.user.id,
        ),
      ).toMatchObject({ status: 'PAID', collectionId: null });
    });
    it.each(['CARD', 'NETBANKING', 'UNKNOWN'])(
      'persists Cashfree method %s in the collection and receipt',
      async (method) => {
        const f = await fixture(),
          service = cashfree(f);
        const order = await service.payInvoice(
          f.client.id,
          f.rider.id,
          f.rental.id,
          randomUUID(),
          false,
          f.user.id,
        );
        f.provider.fetchCheckoutPayments.mockResolvedValue([
          {
            orderId: order.orderId!,
            providerPaymentId: randomUUID(),
            status: 'SUCCESS',
            rawStatus: 'SUCCESS',
            amount: '100.00',
            currency: 'INR',
            paymentMethod: method,
          },
        ] as never);
        const paid = await service.verify(
          f.client.id,
          f.rider.id,
          order.collectionId!,
        );
        expect(paid.method).toBe(method);
        expect(
          await db.riderPayment.findUniqueOrThrow({
            where: { id: paid.paymentId! },
          }),
        ).toMatchObject({ method });
      },
    );
    it('rejects a new top-up for a suspended wallet before gateway creation', async () => {
      const f = await fixture(),
        r = razorpay(f),
        checkout = genericCheckout(f, r);
      const wallet = await f.wallet.ensure(f.client.id, f.rider.id, 'SYSTEM');
      await db.riderWallet.update({
        where: { id: wallet.id },
        data: { status: 'SUSPENDED' },
      });
      await expect(
        checkout.payTopUp(f.client.id, f.rider.id, randomUUID(), '500.00'),
      ).rejects.toThrow('WALLET_INACTIVE');
      expect(r.gateway.createOrder).not.toHaveBeenCalled();
    });
    it('retains a Cashfree capture as review-required while its wallet is suspended', async () => {
      const f = await fixture(),
        service = cashfree(f);
      const order = await service.payTopUp(
        f.client.id,
        f.rider.id,
        randomUUID(),
        '500.00',
      );
      const wallet = await f.wallet.ensure(f.client.id, f.rider.id, 'SYSTEM');
      await db.riderWallet.update({
        where: { id: wallet.id },
        data: { status: 'SUSPENDED' },
      });
      f.success(order.orderId!, '500.00');
      expect(
        await service.verify(f.client.id, f.rider.id, order.collectionId),
      ).toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'WALLET_SETTLEMENT_REQUIRES_REVIEW',
      });
      expect(
        await db.providerPaymentObservation.count({
          where: { collectionId: order.collectionId, status: 'SUCCESS' },
        }),
      ).toBe(1);
      await db.riderWallet.update({
        where: { id: wallet.id },
        data: { status: 'ACTIVE' },
      });
      expect(
        await service.verify(f.client.id, f.rider.id, order.collectionId),
      ).toMatchObject({ status: 'SUCCESS', failureCode: null });
    });
    it('retains late capture evidence on suspension and settles exactly once after reactivation', async () => {
      const f = await fixture(),
        r = razorpay(f),
        checkout = genericCheckout(f, r);
      const order = await checkout.payTopUp(
        f.client.id,
        f.rider.id,
        randomUUID(),
        '500.00',
      );
      const wallet = await f.wallet.ensure(f.client.id, f.rider.id, 'SYSTEM');
      await db.riderWallet.update({
        where: { id: wallet.id },
        data: { status: 'SUSPENDED' },
      });
      const proof = r.capture({
        orderId: order.orderId,
        amount: 50000,
        currency: 'INR',
      });
      await r.service.verify(f.client.id, f.user.id, proof);
      expect(
        await db.razorpayPenaltyCapture.findUniqueOrThrow({
          where: { providerPaymentId: proof.razorpayPaymentId },
        }),
      ).toMatchObject({
        status: 'REVIEW_REQUIRED',
        reason: 'WALLET_SETTLEMENT_REQUIRES_REVIEW',
      });
      expect(
        (await f.wallet.balance(f.client.id, wallet.id)).cash.totalBalance,
      ).toBe('0.00');
      await db.riderWallet.update({
        where: { id: wallet.id },
        data: { status: 'ACTIVE' },
      });
      await checkout.verify(f.client.id, f.rider.id, order.collectionId);
      await checkout.verify(f.client.id, f.rider.id, order.collectionId);
      expect(
        (await f.wallet.balance(f.client.id, wallet.id)).cash.totalBalance,
      ).toBe('500.00');
      expect(
        await db.paymentCollectionRequest.findUniqueOrThrow({
          where: { id: order.collectionId },
        }),
      ).toMatchObject({ status: 'SUCCESS', failureCode: null });
      expect(
        await db.razorpayPenaltyCapture.findUniqueOrThrow({
          where: { providerPaymentId: proof.razorpayPaymentId },
        }),
      ).toMatchObject({ status: 'SETTLED', reason: null });
    });

    async function autoPay() {
      const f = await fixture();
      await f.wallet.ensure(f.client.id, f.rider.id, 'SYSTEM');
      await db.riderPaymentProfile.create({
        data: {
          clientId: f.client.id,
          riderId: f.rider.id,
          autoPayEnabled: true,
        },
      });
      const mandate = await db.paymentMandate.create({
        data: {
          clientId: f.client.id,
          riderId: f.rider.id,
          requestKey: randomUUID(),
          provider: 'CASHFREE',
          providerMandateId: randomUUID(),
          maxAmount: '2500',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });
      const remotes = new Map<string, any>();
      const provider = {
        assertChargeEligible: vi.fn(),
        createPayment: vi.fn(async (input: any) => {
          const result = {
            ...input,
            status: 'PENDING',
            rawStatus: 'SCHEDULED',
            paymentType: 'CHARGE',
            providerReference: randomUUID(),
          };
          remotes.set(input.providerPaymentId, result);
          return result;
        }),
        fetchPayment: vi.fn(async (_mandate: string, id: string) => {
          const result = remotes.get(id);
          if (!result) throw new ProviderRequestError('INVALID_REQUEST', 404);
          return result;
        }),
      };
      const service = new PaymentOrchestratorService(
        db as never,
        { getOrThrow: () => 'cashfree' } as never,
        provider as never,
        new RiderPaymentsService(db as never),
        f.wallet,
      );
      async function reserve(
        claimed = false,
        scheduledAt = new Date(Date.now() + 2 * 86400000),
      ) {
        return db.paymentTransaction.create({
          data: {
            clientId: f.client.id,
            riderId: f.rider.id,
            invoiceId: f.rental.id,
            mandateId: mandate.id,
            requestKey: randomUUID(),
            provider: 'CASHFREE',
            providerPaymentId: randomUUID(),
            amount: '100',
            currency: 'INR',
            scheduledAt,
            providerDebitClaimedAt: claimed ? new Date() : null,
            attempts: {
              create: {
                sequence: 1,
                providerPaymentId: randomUUID(),
                status: 'CREATING',
              },
            },
          },
        });
      }
      return { ...f, mandate, remotes, provider, service, reserve };
    }
    it('prevents wallet settlement while an AutoPay debit is reserved', async () => {
      const f = await autoPay();
      await f.reserve();
      const billing = new WalletBillingService(
        db as never,
        f.wallet,
        new SecurityDepositService(db as never, f.wallet, {} as never),
      );
      await expect(
        billing.settle(f.client.id, f.rental.id, f.user.id, randomUUID()),
      ).rejects.toThrow('AUTOPAY_ALREADY_IN_PROGRESS');
    });
    it('backfills historical creating reservations conservatively without committing audit mutations', async () => {
      const f = await autoPay(),
        row = await f.reserve();
      const migration = await readFile(
        new URL(
          '../../prisma/migrations/20261114160000_cashfree_dispatch_recovery/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const rollback = new Error('ROLLBACK_BACKFILL_PROBE');
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(migration);
          expect(
            (
              await tx.paymentTransaction.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).providerDebitClaimedAt,
          ).toEqual(row.createdAt);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(
        (
          await db.paymentTransaction.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).providerDebitClaimedAt,
      ).toBeNull();
    });
    it('recovers a proven-unsent Cashfree reservation with one dispatch under concurrent verification', async () => {
      const f = await autoPay(),
        row = await f.reserve();
      await Promise.all([
        f.service.verify(f.client.id, f.rider.id, row.id),
        f.service.verify(f.client.id, f.rider.id, row.id),
      ]);
      expect(f.provider.createPayment).toHaveBeenCalledTimes(1);
      expect(f.provider.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: row.id,
          providerPaymentId: row.providerPaymentId,
          scheduledAt: row.scheduledAt.toISOString(),
        }),
      );
      expect(
        await db.paymentTransaction.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toMatchObject({ status: 'PENDING' });
    });
    it('releases expired unsent reservations without a debit and preserves uncertain historical claims', async () => {
      const f = await autoPay(),
        unsent = await f.reserve(false, new Date(Date.now() - 86400000));
      expect(
        await f.service.verify(f.client.id, f.rider.id, unsent.id),
      ).toMatchObject({
        status: 'FAILED',
        failureCode: 'UNSENT_COLLECTION_NO_LONGER_ELIGIBLE',
      });
      const claimed = await f.reserve(true);
      expect(
        await f.service.verify(f.client.id, f.rider.id, claimed.id),
      ).toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'CREATE_UNCERTAIN_REQUIRES_REVIEW',
      });
      expect(f.provider.createPayment).not.toHaveBeenCalled();
    });
    it('fetches an accepted debit after a lost create response without repeating its POST', async () => {
      const f = await autoPay(),
        row = await f.reserve(true);
      f.remotes.set(row.providerPaymentId, {
        providerMandateId: f.mandate.providerMandateId,
        providerPaymentId: row.providerPaymentId,
        status: 'PENDING',
        rawStatus: 'SCHEDULED',
      });
      expect(
        await f.service.verify(f.client.id, f.rider.id, row.id),
      ).toMatchObject({ status: 'PENDING' });
      expect(f.provider.createPayment).not.toHaveBeenCalled();
    });
    it('allows an explicit new collection after full payment reversal while preserving the old success', async () => {
      const f = await autoPay();
      const first = await f.service.collect(
        f.client.id,
        f.rider.id,
        f.rental.id,
        randomUUID(),
        new Date(Date.now() + 2 * 86400000).toISOString(),
      );
      f.remotes.get(first.providerPaymentId).status = 'SUCCESS';
      await f.service.verify(f.client.id, f.rider.id, first.paymentId);
      const paid = await db.paymentTransaction.findUniqueOrThrow({
        where: { id: first.paymentId },
      });
      await db.$transaction((tx) =>
        new RiderPaymentsService(
          db as never,
        ).confirmProviderRefundInTransaction(tx, {
          clientId: f.client.id,
          riderId: f.rider.id,
          paymentId: paid.riderPaymentId!,
          refundId: randomUUID(),
          amount: new Prisma.Decimal(100),
          actorId: f.user.id,
          reason: 'Audit reversal regression',
          treatment: 'PAYMENT_REVERSAL',
        }),
      );
      expect(
        await f.service.collect(
          f.client.id,
          f.rider.id,
          f.rental.id,
          randomUUID(),
          new Date(Date.now() + 2 * 86400000).toISOString(),
        ),
      ).toMatchObject({ status: 'PENDING' });
      expect(
        await db.paymentTransaction.findUniqueOrThrow({
          where: { id: first.paymentId },
        }),
      ).toMatchObject({ status: 'SUCCESS' });
    });
    it('advances past failed recovery rows instead of starving later records', async () => {
      const f = await fixture();
      const rows = await Promise.all(
        [0, 1, 2].map((i) =>
          db.paymentCollectionRequest.create({
            data: {
              clientId: f.client.id,
              riderId: f.rider.id,
              collectionType: 'TOP_UP',
              provider: 'CASHFREE',
              method: 'UNKNOWN',
              status: 'PENDING',
              amount: '500',
              currency: 'INR',
              idempotencyKey: randomUUID(),
              createdAt: new Date(0),
              updatedAt: new Date(i),
            },
          }),
        ),
      );
      const seen: string[] = [];
      const scoped: any = {};
      scoped.paymentTransaction = { findMany: async () => [] };
      scoped.paymentRefund = { findMany: async () => [] };
      scoped.paymentProviderEvent = { findMany: async () => [] };
      scoped.paymentCollectionRequest = {
        findMany: (args: any) =>
          db.paymentCollectionRequest.findMany({
            ...args,
            where: { ...args.where, clientId: f.client.id },
          }),
        update: db.paymentCollectionRequest.update.bind(
          db.paymentCollectionRequest,
        ),
      };
      const recovery = new AutoCollectionService(
        scoped as never,
        {} as never,
        {
          verify: async (_c: string, _r: string, id: string) => {
            seen.push(id);
            throw new Error('merchant unavailable');
          },
        } as never,
        {} as never,
        {} as never,
      );
      await recovery.reconcileOpen(2);
      await recovery.reconcileOpen(2);
      expect(new Set(seen)).toEqual(new Set(rows.map((r) => r.id)));
    });
  },
);
