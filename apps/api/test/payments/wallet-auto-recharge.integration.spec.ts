import { Client } from 'pg';
// @ts-expect-error Standalone migration script has no declarations.
import { migrateUnifiedAutoPay } from '../../scripts/migrate-unified-autopay.mjs';
import { UnifiedAutoPayService } from '../../src/payments/unified-autopay.service.js';
import { WalletSettlementCoordinator } from '../../src/wallet/wallet-settlement-coordinator.service.js';
import { WalletBillingService } from '../../src/wallet/wallet-billing.service.js';
import { ProviderSettlementService } from '../../src/payments/provider-settlement.service.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import {
  WalletAutoRechargeService,
  rechargeNeeded,
} from '../../src/payments/wallet-auto-recharge.service.js';
import { PaymentAutomationService } from '../../src/payments/payment-automation.service.js';
import { RazorpayEventRouter } from '../../src/payments/razorpay/razorpay-event-router.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { RazorpayRecurringClient } from '../../src/payments/razorpay/razorpay-recurring.client.js';
import type { RazorpayAutoPayProvider } from '../../src/payments/razorpay/razorpay-autopay.provider.js';
import type { NotificationService } from '../../src/notifications/notification.service.js';
const url = process.env.AUTOPAY_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost:5432/unused',
);
afterAll(() => db.$disconnect());
it('uses the strict decimal threshold', () => {
  expect(rechargeNeeded('549.99', '550.00')).toBe(true);
  expect(rechargeNeeded('550.00', '550.00')).toBe(false);
});
describe.skipIf(!url)('Wallet AutoPay PostgreSQL', () => {
  async function fixture(initial = '289.00') {
    const suffix = randomUUID();
    const client = await db.client.create({
      data: {
        name: 'Wallet AutoPay test',
        slug: suffix,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    const user = await db.user.create({
      data: {
        clientId: client.id,
        mobile: suffix,
        name: 'Test rider',
        role: 'RIDER',
        isActive: true,
      },
    });
    const rider = await db.rider.create({
      data: {
        clientId: client.id,
        userId: user.id,
        name: 'Test rider',
        mobile: suffix,
        status: 'ACTIVE',
      },
    });
    const oem = await db.oem.create({
      data: { code: suffix, name: suffix, displayName: suffix },
    });
    const category = await db.vehicleCategory.create({
      data: { code: suffix, name: suffix },
    });
    const type = await db.vehicleType.create({
      data: {
        code: suffix,
        name: suffix,
        categoryId: category.id,
        energyType: 'ELECTRIC',
      },
    });
    const fleet = await db.fleet.create({
      data: {
        clientId: client.id,
        fleetCode: suffix,
        chassisNumber: suffix,
        oemId: oem.id,
        vehicleCategoryId: category.id,
        vehicleTypeId: type.id,
        speedType: 'SLOW_SPEED',
      },
    });
    const allocation = await db.allocation.create({
      data: {
        clientId: client.id,
        riderId: rider.id,
        fleetId: fleet.id,
        initiatedById: user.id,
        status: 'ACTIVE',
        allocatedAt: new Date(),
      },
    });
    const mandate = await db.paymentMandate.create({
      data: {
        clientId: client.id,
        riderId: rider.id,
        requestKey: suffix,
        provider: 'RAZORPAY',
        providerMandateId: `mandate_${suffix}`,
        providerTokenId: `token_${suffix}`,
        providerCustomerId: `cust_${suffix}`,
        providerCustomerEmail: 'test@example.com',
        providerKeyId: 'rzp_test_wallet',
        status: 'ACTIVE',
        maxAmount: '750',
        expiresAt: new Date(Date.now() + 90 * 86400000),
      },
    });
    await db.riderPaymentProfile.create({
      data: { clientId: client.id, riderId: rider.id, autoPayEnabled: true },
    });
    const walletService = new WalletService(db as unknown as PrismaService);
    const wallet = await walletService.ensure(client.id, rider.id);
    const accounts = await db.walletAccount.findMany({
      where: { walletId: wallet.id },
    });
    async function post(amount: string, rental = false) {
      const cash = accounts.find((a) => a.accountType === 'CASH')!,
        clearing = accounts.find((a) => a.accountType === 'PROVIDER_CLEARING')!;
      await walletService.locked(wallet.id, (tx) =>
        walletService.postInTransaction(tx, {
          clientId: client.id,
          walletId: wallet.id,
          actorId: 'SYSTEM',
          type: rental ? 'RENTAL' : 'TOP_UP',
          amount,
          currency: 'INR',
          description: 'Test funding',
          idempotencyKey: randomUUID(),
          entries: [
            {
              accountId: cash.id,
              entryType: rental ? 'DEBIT' : 'CREDIT',
              amount,
            },
            {
              accountId: clearing.id,
              entryType: rental ? 'CREDIT' : 'DEBIT',
              amount,
            },
          ],
        }),
      );
    }
    await post(initial);
    await db.walletAutoRechargePolicy.create({
      data: { clientId: client.id, enabled: true },
    });
    await db.walletAutoRechargePreference.create({
      data: {
        clientId: client.id,
        riderId: rider.id,
        walletId: wallet.id,
        mandateId: mandate.id,
        enabled: true,
        consentRevision: 1,
      },
    });
    type Payment = {
      id: string;
      order_id: string;
      amount: number;
      currency: string;
      status: string;
      captured: boolean;
      customer_id: string;
      token_id: string;
      method: string;
      amount_refunded: number;
    };
    const payments: Payment[] = [],
      orders: Array<{
        id: string;
        receipt: string;
        amount: number;
        currency: string;
      }> = [];
    const gateway = {
      enabled: true,
      assertConfigured: vi.fn().mockResolvedValue(undefined),
      createDebitOrder: vi.fn(async (amount: number, receipt: string) => {
        const order = {
          id: `order_${randomUUID()}`,
          receipt,
          amount,
          currency: 'INR',
        };
        orders.push(order);
        return order;
      }),
      findOrders: vi.fn(async (receipt: string) =>
        orders.filter((o) => o.receipt === receipt),
      ),
      recurringOrderPayments: vi.fn(async (order: string) =>
        payments.filter((p) => p.order_id === order),
      ),
      recurringPayment: vi.fn(async (id: string) =>
        payments.find((p) => p.id === id),
      ),
      createRecurringPayment: vi.fn(
        async (input: { orderId: string; amount: number }) => {
          const payment = {
            id: `pay_${randomUUID()}`,
            order_id: input.orderId,
            amount: input.amount,
            currency: 'INR',
            status: 'created',
            captured: false,
            customer_id: mandate.providerCustomerId!,
            token_id: mandate.providerTokenId!,
            method: 'upi',
            amount_refunded: 0,
          };
          payments.push(payment);
          return { razorpay_payment_id: payment.id };
        },
      ),
    };
    const notifications = { sendToUsers: vi.fn().mockResolvedValue({}) };
    const config = new ConfigService({ RAZORPAY_AUTOPAY_ENABLED: 'true' });
    const service = new WalletAutoRechargeService(
      db as unknown as PrismaService,
      walletService,
      gateway as unknown as RazorpayRecurringClient,
      {
        fetchMandate: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      } as unknown as RazorpayAutoPayProvider,
      config,
      new PaymentAutomationService(db as unknown as PrismaService),
      notifications as unknown as NotificationService,
      new RazorpayEventRouter(),
    );
    async function request() {
      return db.walletAutoRecharge.findFirstOrThrow({
        where: { walletId: wallet.id },
      });
    }
    async function reconcile() {
      const item = await request();
      await db.paymentAutomationJob.updateMany({
        where: { key: `wallet-recharge:${item.id}` },
        data: { nextAttemptAt: new Date(0) },
      });
      await service.reconcile(item.id);
      return request();
    }
    async function balance() {
      return (await walletService.balance(client.id, wallet.id)).cash
        .availableBalance;
    }
    return {
      client,
      rider,
      user,
      wallet,
      mandate,
      allocation,
      walletService,
      service,
      gateway,
      notifications,
      config,
      payments,
      orders,
      post,
      request,
      reconcile,
      balance,
    };
  }
  it('migration dry-run is inert, apply preserves consent/money, and repeat apply is a no-op', async () => {
    const f = await fixture('1000.00');
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const options = { clientId: f.client.id, runId: randomUUID() };
      expect(await migrateUnifiedAutoPay(client, options)).toMatchObject({ apply: false, counts: { ELIGIBLE: 1 } });
      expect((await db.riderPaymentProfile.findUniqueOrThrow({ where: { clientId_riderId: { clientId: f.client.id, riderId: f.rider.id } } })).collectionMode).toBe('LEGACY_INVOICE');
      expect(await migrateUnifiedAutoPay(client, { ...options, apply: true })).toMatchObject({ counts: { ELIGIBLE: 1 } });
      expect(await migrateUnifiedAutoPay(client, { ...options, apply: true })).toMatchObject({ counts: { ALREADY_MIGRATED: 1 } });
      expect(await f.balance()).toBe('1000.00');
      expect(await db.walletAutoRecharge.count({ where: { walletId: f.wallet.id } })).toBe(0);
      expect(await db.auditLog.count({ where: { clientId: f.client.id, action: 'UNIFIED_AUTOPAY_MIGRATED' } })).toBe(1);
    } finally { await client.end(); }
  });
  it('onboarding recovery cannot undo a later explicit disable', async () => {
    const f = await fixture('1000.00');
    f.config.set('UNIFIED_AUTOPAY_ENABLED', 'true');
    f.config.set('UNIFIED_AUTOPAY_CLIENT_IDS', f.client.id);
    const consentAt = new Date(Date.now() - 1000);
    await f.service.setEnabled(f.client.id, f.user.id, { enabled: false });
    const revision = (await f.service.current(f.client.id, f.user.id)).revision;
    await expect(f.service.setEnabled(f.client.id, f.user.id, { enabled: true, unified: true, mandateId: f.mandate.id, consentRevision: 1, expectedRevision: revision, recoveryConsentAt: consentAt })).rejects.toThrow('AUTOPAY_DISABLED_AFTER_CONSENT');
  });
  it('unified consent atomically selects wallet collection and rejects stale devices', async () => {
    const f = await fixture('1000.00');
    f.config.set('UNIFIED_AUTOPAY_ENABLED', 'true');
    f.config.set('UNIFIED_AUTOPAY_CLIENT_IDS', f.client.id);
    const unified = new UnifiedAutoPayService(db as unknown as PrismaService, f.service, f.config);
    const results = await Promise.allSettled([1, 2].map(() => unified.set(f.client.id, f.user.id, { enabled: true, expectedRevision: 0, mandateId: f.mandate.id, consentRevision: 1, consentVersion: 'unified-autopay-v1' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const profile = await db.riderPaymentProfile.findUniqueOrThrow({ where: { clientId_riderId: { clientId: f.client.id, riderId: f.rider.id } } });
    expect(profile).toMatchObject({ collectionMode: 'LEDGER_WALLET', autoSettleInvoiceFromWallet: true });
    await unified.set(f.client.id, f.user.id, { enabled: false, expectedRevision: 1 });
    expect((await unified.current(f.client.id, f.user.id)).effectiveStatus).toBe('OFF');
    expect((await db.riderPaymentProfile.findUniqueOrThrow({ where: { id: profile.id } })).collectionMode).toBe('LEDGER_WALLET');
    await expect(f.service.setEnabled(f.client.id, f.user.id, { enabled: true, mandateId: f.mandate.id, consentRevision: 1 })).rejects.toThrow('UNIFIED_AUTOPAY_CONSENT_REQUIRED');
  });
  it('unified activation is unavailable outside the client allowlist', async () => {
    const f = await fixture('1000.00');
    f.config.set('UNIFIED_AUTOPAY_ENABLED', 'true');
    const unified = new UnifiedAutoPayService(db as unknown as PrismaService, f.service, f.config);
    await expect(unified.set(f.client.id, f.user.id, { enabled: true, expectedRevision: 0, mandateId: f.mandate.id, consentRevision: 1, consentVersion: 'unified-autopay-v1' })).rejects.toThrow('UNIFIED_AUTOPAY_UNAVAILABLE');
  });
  it('settles remaining rent after a later top-up without duplicating deductions, even with funding off', async () => {
    const f = await fixture('100.00');
    await db.riderPaymentProfile.update({ where: { clientId_riderId: { clientId: f.client.id, riderId: f.rider.id } }, data: { collectionMode: 'LEDGER_WALLET' } });
    await db.walletAutoRechargePreference.update({ where: { walletId: f.wallet.id }, data: { enabled: false } });
    const invoice = await db.riderInvoice.create({ data: { clientId: f.client.id, riderId: f.rider.id, invoiceNumber: randomUUID(), invoiceType: 'RENTAL', billingPeriodStart: new Date(), billingPeriodEnd: new Date(), subtotal: '200.00', creditAmount: '0.00', totalAmount: '200.00', outstandingAmount: '200.00', currency: 'INR', dueDate: new Date(), issuedAt: new Date(), status: 'FINALIZED' } });
    const billing = new WalletBillingService(db as unknown as PrismaService, f.walletService, {} as never);
    const coordinator = new WalletSettlementCoordinator(db as unknown as PrismaService, f.walletService, billing);
    await Promise.all([coordinator.settle(f.wallet.id), coordinator.settle(f.wallet.id)]);
    expect((await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).outstandingAmount.toFixed(2)).toBe('100.00');
    await f.post('150.00');
    await Promise.all([coordinator.settle(f.wallet.id), coordinator.settle(f.wallet.id)]);
    expect((await db.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID');
    expect(await f.balance()).toBe('50.00');
    expect(await db.walletTransaction.count({ where: { walletId: f.wallet.id, referenceType: 'RIDER_INVOICE', referenceId: invoice.id } })).toBe(2);
    expect(await db.riderLedgerEntry.count({ where: { clientId: f.client.id, riderId: f.rider.id, sourceType: 'WALLET_INVOICE_PAYMENT' } })).toBe(2);
  });
  it('concurrent workers submit once and captured payment credits once', async () => {
    const f = await fixture();
    await Promise.all(
      Array.from({ length: 8 }, () => f.service.evaluate(f.wallet.id)),
    );
    expect(
      await db.walletAutoRecharge.count({ where: { walletId: f.wallet.id } }),
    ).toBe(1);
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
    expect(await f.balance()).toBe('289.00');
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    await f.reconcile();
    await f.reconcile();
    expect(await f.balance()).toBe('1039.00');
    expect(
      await db.walletTransaction.count({
        where: {
          referenceType: 'WALLET_AUTO_RECHARGE',
          referenceId: (await f.request()).id,
        },
      }),
    ).toBe(1);
  });
  it('matches wallet AutoPay settlements only for the owning merchant and verified successful amount', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    const service = new ProviderSettlementService(db as never);
    const report = (amount = '750.00') => ({ provider: 'RAZORPAY' as const, providerSettlementId: randomUUID(), currency: 'INR', grossAmount: amount, refundAmount: '0.00', feeAmount: '0.00', taxAmount: '0.00', netAmount: amount, settledAt: new Date().toISOString(), items: [{ kind: 'PAYMENT' as const, providerReference: f.payments[0].id, amount }] });
    const pending = await service.importReport(f.client.id, f.user.id, report());
    expect(pending.items[0].status).not.toBe('MATCHED');
    f.payments[0].captured = true; f.payments[0].status = 'captured';
    await f.reconcile();
    const rematched = await service.rematch(f.client.id, pending.id, f.user.id);
    expect(rematched.items[0]).toMatchObject({ status: 'MATCHED', localReferenceId: (await f.request()).id });
    const wrong = await service.importReport(f.client.id, f.user.id, report('749.00'));
    expect(wrong.items[0].status).toBe('AMOUNT_MISMATCH');
    const other = await fixture();
    expect((await service.importReport(other.client.id, other.user.id, report())).items[0].status).toBe('MISSING_INTERNAL');
  });
  it('evaluates immediately after rental commit, not at exactly the threshold', async () => {
    const f = await fixture('550.00');
    f.service.onModuleInit();
    await f.service.evaluate(f.wallet.id);
    expect(f.orders).toHaveLength(0);
    await f.post('261.00', true);
    expect((await f.request()).balanceAtTrigger.toFixed(2)).toBe('289.00');
    expect((await f.request()).amount.toFixed(2)).toBe('750.00');
  });
  it.each(['return', 'disabled', 'consent', 'revoked'])(
    'blocks ineligible rider: %s',
    async (reason) => {
      const f = await fixture();
      if (reason === 'return')
        await db.allocation.update({
          where: { id: f.allocation.id },
          data: { status: 'DEALLOCATION_INITIATED' },
        });
      if (reason === 'disabled')
        await db.walletAutoRechargePreference.update({
          where: { walletId: f.wallet.id },
          data: { enabled: false },
        });
      if (reason === 'consent')
        await db.walletAutoRechargePolicy.update({
          where: { clientId: f.client.id },
          data: { revision: 2 },
        });
      if (reason === 'revoked')
        await db.paymentMandate.update({
          where: { id: f.mandate.id },
          data: { status: 'CANCELLED' },
        });
      await f.service.evaluate(f.wallet.id);
      expect(f.orders).toHaveLength(0);
    },
  );
  it('recovers lost debit response and settles even after disabling the feature', async () => {
    const f = await fixture(),
      create = f.gateway.createRecurringPayment.getMockImplementation()!;
    f.gateway.createRecurringPayment.mockImplementationOnce(async (input) => {
      await create(input);
      throw new Error('lost response');
    });
    await f.service.evaluate(f.wallet.id);
    expect((await f.request()).status).toBe('UNKNOWN');
    await f.service.evaluate(f.wallet.id);
    await db.walletAutoRechargePreference.update({
      where: { walletId: f.wallet.id },
      data: { enabled: false },
    });
    f.config.set('RAZORPAY_AUTOPAY_ENABLED', 'false');
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    expect((await f.reconcile()).status).toBe('SUCCESS');
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost order by receipt without another order POST', async () => {
    const f = await fixture(),
      create = f.gateway.createDebitOrder.getMockImplementation()!;
    f.gateway.createDebitOrder.mockImplementationOnce(
      async (amount, receipt) => {
        await create(amount, receipt);
        throw new Error('lost order');
      },
    );
    await f.service.evaluate(f.wallet.id);
    await f.reconcile();
    expect(f.gateway.createDebitOrder).toHaveBeenCalledTimes(1);
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
  });
  it('keeps uncertain debit pending, never retries POST, and notifies once after 36 hours', async () => {
    const f = await fixture();
    f.gateway.createRecurringPayment.mockRejectedValueOnce(
      new Error('timeout'),
    );
    await f.service.evaluate(f.wallet.id);
    await db.walletAutoRecharge.update({
      where: { id: (await f.request()).id },
      data: { createdAt: new Date(Date.now() - 37 * 3600000) },
    });
    await f.reconcile();
    await f.reconcile();
    await f.service.evaluate(f.wallet.id);
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
    expect(f.notifications.sendToUsers).toHaveBeenCalledTimes(1);
    expect((await f.request()).status).toBe('UNKNOWN');
  });
  it('does not credit a capture belonging to another customer', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    f.payments[0].customer_id = 'cust_other';
    expect((await f.reconcile()).status).toBe('REVIEW_REQUIRED');
    expect(await f.balance()).toBe('289.00');
  });
  it('cancels before debit submission if manual funding raises the balance', async () => {
    const f = await fixture(),
      create = f.gateway.createDebitOrder.getMockImplementation()!;
    f.gateway.createDebitOrder.mockImplementationOnce(
      async (amount, receipt) => {
        const order = await create(amount, receipt);
        await f.post('750.00');
        return order;
      },
    );
    await f.service.evaluate(f.wallet.id);
    expect(f.gateway.createRecurringPayment).not.toHaveBeenCalled();
    expect((await f.request()).status).toBe('CANCELLED');
  });
  it('definitive failure requires rider action instead of automatic retry', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    f.payments[0].status = 'failed';
    expect((await f.reconcile()).status).toBe('FAILED');
    await f.service.evaluate(f.wallet.id);
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
    expect(f.notifications.sendToUsers).toHaveBeenCalledTimes(1);
  });
  it('database rejects a second unresolved recharge', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    const {
      id: _id,
      providerOrderId: _order,
      providerPaymentId: _payment,
      ...data
    } = await f.request();
    await expect(db.walletAutoRecharge.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
  });
  it('requires fresh consent after policy amounts change and rejects another rider mandate', async () => {
    const f = await fixture();
    await expect(
      f.service.setEnabled(f.client.id, f.user.id, {
        enabled: true,
        mandateId: 'other',
        consentRevision: 1,
      }),
    ).rejects.toThrow();
    const policy = await f.service.setPolicy(f.client.id, f.user.id, {
      enabled: true,
      threshold: '600.00',
      rechargeAmount: '800.00',
      revision: 1,
    });
    expect(policy.revision).toBe(2);
    await expect(
      f.service.setEnabled(f.client.id, f.user.id, {
        enabled: true,
        mandateId: f.mandate.id,
        consentRevision: 1,
      }),
    ).rejects.toThrow();
    await f.service.evaluate(f.wallet.id);
    expect(f.orders).toHaveLength(0);
    await expect(
      f.service.verifyForClient('other-client', randomUUID()),
    ).rejects.toThrow();
  });
  it('enforces the post-success cooldown even if balance becomes low again', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    await f.reconcile();
    await f.post('600.00', true);
    await f.service.evaluate(f.wallet.id);
    expect(await f.balance()).toBe('439.00');
    expect(f.gateway.createRecurringPayment).toHaveBeenCalledTimes(1);
  });
  it('quarantines multiple captures without crediting either payment', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    f.payments.push({ ...f.payments[0], id: `pay_${randomUUID()}` });
    expect((await f.reconcile()).status).toBe('REVIEW_REQUIRED');
    expect(await f.balance()).toBe('289.00');
  });
  it('detects a later external refund without silently changing an existing wallet credit', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    await f.reconcile();
    f.payments[0].amount_refunded = 75000;
    f.payments[0].status = 'refunded';
    expect((await f.reconcile()).status).toBe('REVIEW_REQUIRED');
    expect(await f.balance()).toBe('1039.00');
  });
  it('still credits a captured debit after the scooter return starts', async () => {
    const f = await fixture();
    await f.service.evaluate(f.wallet.id);
    await db.allocation.update({
      where: { id: f.allocation.id },
      data: { status: 'DEALLOCATION_INITIATED' },
    });
    f.payments[0].captured = true;
    f.payments[0].status = 'captured';
    expect((await f.reconcile()).status).toBe('SUCCESS');
    expect(await f.balance()).toBe('1039.00');
  });
});
