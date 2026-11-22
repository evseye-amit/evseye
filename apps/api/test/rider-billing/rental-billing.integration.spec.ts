import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestPrisma } from '../helpers/prisma-client.js';
import { RiderBillingEngineService } from '../../src/rider-billing/rider-billing-engine.service.js';
import { RiderPaymentsService } from '../../src/rider-billing/rider-payments.service.js';
import { RentalBillingRunner } from '../../src/rider-billing/rental-billing-runner.service.js';
import { RentalBillingOperations } from '../../src/rider-billing/rental-billing-operations.service.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import { WalletBillingService } from '../../src/wallet/wallet-billing.service.js';
import { WalletSettlementCoordinator } from '../../src/wallet/wallet-settlement-coordinator.service.js';
import { transactionHistory } from '../../src/wallet/transaction-history.js';

const url = process.env.RENTAL_BILLING_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_'))
  throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(
  url ?? 'postgresql://unused:unused@localhost:5432/unused',
);
const engine = new RiderBillingEngineService(
  db as never,
  new RiderPaymentsService(db as never),
);
const wallet = new WalletService(db as never);
const collector = new WalletSettlementCoordinator(
  db as never,
  wallet,
  new WalletBillingService(db as never, wallet, {} as never),
);
const operations = new RentalBillingOperations(
  db as never,
  engine,
  wallet,
  collector,
);
const clients: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  if (url)
    await db.riderBillingSchedule.updateMany({
      where: { clientId: { in: clients } },
      data: { status: 'CLOSED' },
    });
});
afterAll(() => db.$disconnect());
async function fixture(
  options: {
    clientId?: string;
    historical?: boolean;
    postpaid?: boolean;
    broken?: boolean;
  } = {},
) {
  const key = randomUUID(),
    now = new Date(),
    start = new Date(now.getTime() - 3600000);
  const clientId =
    options.clientId ??
    (
      await db.client.create({
        data: { name: 'Rental test', slug: key, status: 'ACTIVE' },
      })
    ).id;
  if (!clients.includes(clientId)) clients.push(clientId);
  const actor = await db.user.create({
    data: {
      clientId,
      name: 'Rental operator',
      mobile: key.slice(0, 10),
      role: 'CLIENT_ADMIN',
    },
  });
  const rider = await db.rider.create({
    data: {
      clientId,
      name: 'Rental rider',
      mobile: key.slice(0, 10),
      status: 'ACTIVE',
    },
  });
  const identity = {
    clientId,
    riderId: rider.id,
    vehicleId: key,
    rateCardId: key,
    rateCardVersionId: key,
    rentalPeriodType: 'DAILY' as const,
    currency: 'INR',
    finalRecurringAmount: '100',
    upfrontAmount: '0',
    refundableAmount: '0',
    termsVersion: '1',
    termsTitle: 'Terms',
    termsSnapshot: 'Terms',
    termsHash: 'a'.repeat(64),
    createdById: key,
  };
  const pricingSnapshot = {
    currency: 'INR',
    rental: { period: 'DAILY', finalAmount: '100.00' },
    oneTimeCharges: [],
  };
  const offer = await db.riderCommercialOffer.create({
    data: {
      ...identity,
      offerNumber: key,
      effectiveDate: start,
      pricingSnapshot,
      calculationHash: 'a'.repeat(64),
      selectionHash: 'a'.repeat(64),
      expiresAt: now,
    },
  });
  const agreement = await db.riderRentalAgreement.create({
    data: {
      ...identity,
      agreementNumber: key,
      commercialOfferId: offer.id,
      pricingSnapshot,
      pricingSnapshotSchemaVersion: 1,
      pricingHash: 'a'.repeat(64),
      acceptedAt: start,
      acceptedById: key,
      acceptanceMethod: 'APP_CONFIRMATION',
      activatedAt: start,
      status: 'ACTIVE',
    },
  });
  await db.riderPaymentProfile.create({
    data: {
      clientId,
      riderId: rider.id,
      collectionMode: 'LEDGER_WALLET',
      autoSettleInvoiceFromWallet: true,
    },
  });
  if (!options.broken)
    await db.riderAgreementCommercialVersion.create({
      data: {
        clientId,
        agreementId: agreement.id,
        versionNumber: 1,
        vehicleId: key,
        rateCardVersionId: key,
        pricingSnapshot,
        pricingHash: 'a'.repeat(64),
        termsVersion: '1',
        termsHash: 'a'.repeat(64),
        termsSnapshot: 'Terms',
        termsTitle: 'Terms',
        recurringAmount: '100',
        effectiveFrom: start,
        status: 'ACTIVE',
      },
    });
  await db.riderTaxProfile.upsert({
    where: { clientId },
    create: {
      clientId,
      supplierState: 'Delhi',
      placeOfSupply: 'Delhi',
      rules: {
        create: {
          clientId,
          taxCode: 'EXEMPT',
          chargeType: 'RENTAL',
          effectiveFrom: new Date('2020-01-01'),
        },
      },
    },
    update: {},
  });
  const schedule = await db.riderBillingSchedule.create({
    data: {
      clientId,
      riderId: rider.id,
      agreementId: agreement.id,
      frequency: 'DAILY',
      billingMode: options.postpaid ? 'POSTPAID' : 'PREPAID',
      anchorType: 'VEHICLE_HANDOVER',
      anchorAt: start,
      timezone: 'Asia/Kolkata',
      nextPeriodStart: start,
      automaticFrom: options.historical ? now : start,
    },
  });
  return { clientId, rider, agreement, schedule, actorId: actor.id };
}
async function only(clientId: string) {
  vi.stubEnv('RENTAL_BILLING_CLIENT_IDS', clientId);
  // Other suites may leave schedules; prevent them occupying this isolated run's claim batch.
  await db.riderBillingSchedule.updateMany({
    where: { clientId: { not: clientId }, status: 'ACTIVE' },
    data: { nextAttemptAt: new Date(Date.now() + 86400000) },
  });
}
describe.skipIf(!url)('reliable rent billing in PostgreSQL', () => {
  it('rolls previews back, rejects stale approvals, and applies approved recovery once', async () => {
    const f = await fixture({ historical: true });
    await only(f.clientId);
    const preview = (await operations.preview(f.clientId, f.schedule.id)) as {
      fingerprint: string;
      periodStart: string;
      totalAmount: string;
    };
    expect(preview.totalAmount).toBe('100.00');
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    expect(
      await db.riderCharge.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    expect(
      await db.riderBillingPeriod.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    expect(
      (
        await db.riderBillingSchedule.findUniqueOrThrow({
          where: { id: f.schedule.id },
        })
      ).nextPeriodStart,
    ).toEqual(f.schedule.nextPeriodStart);
    await expect(
      operations.approveRecovery(
        f.clientId,
        f.schedule.id,
        f.actorId,
        preview.periodStart,
        'b'.repeat(64),
      ),
    ).rejects.toThrow('RECOVERY_PREVIEW_STALE');
    const approved = await operations.approveRecovery(
      f.clientId,
      f.schedule.id,
      f.actorId,
      preview.periodStart,
      preview.fingerprint,
    );
    expect(
      await operations.approveRecovery(
        f.clientId,
        f.schedule.id,
        f.actorId,
        preview.periodStart,
        preview.fingerprint,
      ),
    ).toMatchObject({ invoiceId: approved.invoiceId, alreadyApplied: true });
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(1);
    await expect(
      operations.preview(randomUUID(), f.schedule.id),
    ).rejects.toThrow('BILLING_SCHEDULE_NOT_FOUND');
  });
  it('two workers process the same due period only once; future postpaid and historical periods stay unbilled', async () => {
    const f = await fixture();
    await only(f.clientId);
    const future = await fixture({ clientId: f.clientId, postpaid: true });
    const historical = await fixture({
      clientId: f.clientId,
      historical: true,
    });
    await Promise.all([
      new RentalBillingRunner(db as never, engine).run(),
      new RentalBillingRunner(db as never, engine).run(),
    ]);
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(1);
    expect(
      (
        await db.riderBillingSchedule.findUniqueOrThrow({
          where: { id: historical.schedule.id },
        })
      ).lastError,
    ).toBe('HISTORICAL_RECOVERY_REVIEW_REQUIRED');
    expect(
      (
        await db.riderBillingSchedule.findUniqueOrThrow({
          where: { id: future.schedule.id },
        })
      ).nextPeriodStart,
    ).toEqual(future.schedule.nextPeriodStart);
    const repeated = await db.$transaction((tx) =>
      engine.generateInTransaction(
        tx,
        f.clientId,
        f.schedule.id,
        null,
        f.schedule.nextPeriodStart,
      ),
    );
    expect(repeated.totalAmount.toFixed(2)).toBe('100.00');
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(1);
  });
  it('processes more than twenty riders and isolates a broken schedule', async () => {
    const bad = await fixture({ broken: true });
    await only(bad.clientId);
    for (let i = 0; i < 21; i++) await fixture({ clientId: bad.clientId });
    const result = await new RentalBillingRunner(db as never, engine).run(100);
    expect(result).toMatchObject({ processed: 21, failed: 1 });
    expect(
      await db.riderInvoice.count({ where: { clientId: bad.clientId } }),
    ).toBe(21);
    expect(
      (
        await db.riderBillingSchedule.findUniqueOrThrow({
          where: { id: bad.schedule.id },
        })
      ).failureCount,
    ).toBe(1);
  }, 30000);
  it('uses a deployment receipt once without creating another balance movement', async () => {
    const f = await fixture();
    await only(f.clientId);
    const receipt = await db.riderPayment.create({
      data: {
        clientId: f.clientId,
        riderId: f.rider.id,
        amount: '100',
        unallocatedAmount: '100',
        currency: 'INR',
        method: 'DEPLOYMENT',
        idempotencyKey: randomUUID(),
        receivedAt: new Date(),
        createdById: f.actorId,
      },
    });
    await db.riderLedgerEntry.create({
      data: {
        clientId: f.clientId,
        riderId: f.rider.id,
        agreementId: f.agreement.id,
        entryType: 'PAYMENT',
        sourceType: 'RIDER_PAYMENT',
        sourceId: receipt.id,
        description: 'Deployment rental receipt',
        creditAmount: '100',
        currency: 'INR',
        effectiveAt: new Date(),
      },
    });
    await new RentalBillingRunner(db as never, engine).run();
    const ledger = await wallet.ensure(f.clientId, f.rider.id, f.actorId);
    await collector.settle(ledger.id);
    const history = await db.$transaction((tx) =>
      transactionHistory(tx, {
        clientId: f.clientId,
        riderId: f.rider.id,
        walletId: ledger.id,
        page: 1,
        pageSize: 20,
      }),
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      affectsBalance: false,
      rental: {
        status: 'PAID',
        outstandingAmount: '0.00',
        payments: [
          { id: receipt.id, source: 'DEPLOYMENT_PAYMENT', amount: '100.00' },
        ],
      },
    });
    expect(
      await db.walletTransaction.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    expect(
      (
        await db.riderPayment.findUniqueOrThrow({ where: { id: receipt.id } })
      ).unallocatedAmount.toFixed(2),
    ).toBe('0.00');
    const foreign = await db.$transaction((tx) =>
      transactionHistory(tx, {
        clientId: randomUUID(),
        riderId: f.rider.id,
        page: 1,
        pageSize: 20,
        id: history.items[0].id,
      }),
    );
    expect(foreign.items).toHaveLength(0);
  });
  it('honors generation pause and active leases, then recovers an expired lease', async () => {
    const f = await fixture();
    await only(f.clientId);
    vi.stubEnv('RENTAL_BILLING_ENABLED', 'false');
    await new RentalBillingRunner(db as never, engine).run();
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    vi.stubEnv('RENTAL_BILLING_ENABLED', 'true');
    await db.riderBillingSchedule.update({
      where: { id: f.schedule.id },
      data: {
        leaseToken: 'crashed-worker',
        leaseUntil: new Date(Date.now() + 120000),
      },
    });
    await new RentalBillingRunner(db as never, engine).run();
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(0);
    await db.riderBillingSchedule.update({
      where: { id: f.schedule.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    await new RentalBillingRunner(db as never, engine).run();
    expect(
      await db.riderInvoice.count({ where: { clientId: f.clientId } }),
    ).toBe(1);
  });
  it('shows unpaid rent, collects after funding without bank AutoPay, and never duplicates a deduction', async () => {
    const f = await fixture();
    await only(f.clientId);
    await new RentalBillingRunner(db as never, engine).run();
    const ledger = await wallet.ensure(f.clientId, f.rider.id, f.actorId);
    await collector.settle(ledger.id);
    let history = await db.$transaction((tx) =>
      transactionHistory(tx, {
        clientId: f.clientId,
        riderId: f.rider.id,
        walletId: ledger.id,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(
      history.items.find((i) => i.referenceType === 'RENTAL_INVOICE'),
    ).toMatchObject({
      affectsBalance: false,
      rental: { paidAmount: '0.00', outstandingAmount: '100.00' },
    });
    const accounts = await db.walletAccount.findMany({
      where: { walletId: ledger.id },
    });
    await wallet.locked(ledger.id, (tx) =>
      wallet.postInTransaction(tx, {
        clientId: f.clientId,
        walletId: ledger.id,
        actorId: f.actorId,
        type: 'ADJUSTMENT',
        amount: '150.00',
        currency: 'INR',
        description: 'Test funds',
        idempotencyKey: randomUUID(),
        entries: [
          {
            accountId: accounts.find((a) => a.accountType === 'CASH')!.id,
            entryType: 'CREDIT',
            amount: '150.00',
          },
          {
            accountId: accounts.find((a) => a.accountType === 'CLEARING')!.id,
            entryType: 'DEBIT',
            amount: '150.00',
          },
        ],
      }),
    );
    vi.stubEnv('RENTAL_COLLECTION_ENABLED', 'false');
    await collector.settle(ledger.id);
    expect(
      (await wallet.balance(f.clientId, ledger.id)).cash.totalBalance,
    ).toBe('150.00');
    vi.stubEnv('RENTAL_COLLECTION_ENABLED', 'true');
    await Promise.all([
      collector.settle(ledger.id),
      collector.settle(ledger.id),
    ]);
    await collector.settle(ledger.id);
    expect(
      (await wallet.balance(f.clientId, ledger.id)).cash.totalBalance,
    ).toBe('50.00');
    expect(
      await db.walletTransaction.count({
        where: { clientId: f.clientId, transactionType: 'RENTAL' },
      }),
    ).toBe(1);
    history = await db.$transaction((tx) =>
      transactionHistory(tx, {
        clientId: f.clientId,
        riderId: f.rider.id,
        walletId: ledger.id,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(
      history.items.find((i) => i.referenceType === 'RENTAL_INVOICE'),
    ).toMatchObject({
      rental: {
        status: 'PAID',
        paidAmount: '100.00',
        outstandingAmount: '0.00',
      },
    });
  });
});
