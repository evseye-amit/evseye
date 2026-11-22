import { createTestPrisma } from '../helpers/prisma-client.js';
import { RiderWalletOperationsService } from '../../src/riders/rider-wallet.service.js';
import { RiderWalletTransactionsQueryDto } from '../../src/riders/dto/rider-wallet.dto.js';
import { WalletService } from '../../src/wallet/wallet.service.js';
import { afterAll, describe, expect, it } from 'vitest';
import { type WalletTransactionStatus, type WalletTransactionType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RiderEarningsService } from '../../src/riders/rider-earnings.service.js';
import { RiderEarningsQueryDto } from '../../src/riders/dto/rider-earnings.dto.js';

const url = process.env.RIDER_EARNINGS_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
const db = createTestPrisma(url ?? 'postgresql://unused:unused@localhost:5432/unused');
afterAll(() => db.$disconnect());
const service = new RiderEarningsService(db as never);
const wallets = new RiderWalletOperationsService(db as never, new WalletService(db as never));
const query = (values = {}) => Object.assign(new RiderEarningsQueryDto(), values);
describe.skipIf(!url)('rider earnings in PostgreSQL', () => {
  async function fixture() {
    const client = await db.client.create({ data: { name: 'Earnings test', slug: randomUUID(), status: 'ACTIVE' } });
    const rider = await db.rider.create({ data: { clientId: client.id, name: 'Rider', mobile: '9876543210' } });
    const wallet = await db.riderWallet.create({ data: { clientId: client.id, riderId: rider.id } });
    const reward = await db.walletAccount.create({ data: { clientId: client.id, walletId: wallet.id, currency: 'INR', accountType: 'REWARD' } });
    const clearing = await db.walletAccount.create({ data: { clientId: client.id, walletId: wallet.id, currency: 'INR', accountType: 'CLEARING' } });
    async function earning(type: WalletTransactionType, amount: string, postedAt: string, status: WalletTransactionStatus = 'POSTED', credit = true) {
      const txn = await db.walletTransaction.create({ data: { clientId: client.id, walletId: wallet.id, transactionNumber: randomUUID(), transactionType: type, status, currency: 'INR', amount, description: 'Test reward', idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), postedAt: new Date(postedAt) } });
      await db.walletLedgerEntry.createMany({ data: [
        { clientId: client.id, walletId: wallet.id, accountId: reward.id, transactionId: txn.id, entryType: credit ? 'CREDIT' : 'DEBIT', amount, currency: 'INR', sequence: 1 },
        { clientId: client.id, walletId: wallet.id, accountId: clearing.id, transactionId: txn.id, entryType: credit ? 'DEBIT' : 'CREDIT', amount, currency: 'INR', sequence: 2 },
      ] });
      return txn;
    }
    return { client, rider, wallet, earning, reward, clearing };
  }
  it('counts only posted reward credits, excludes reversals and other riders, and sums decimals exactly', async () => {
    const f = await fixture();
    await f.earning('REWARD', '100.10', '2026-09-30T23:59:59.999Z');
    await f.earning('REFERRAL_REWARD', '50.20', '2026-10-01T00:00:00.000Z');
    await f.earning('SELF_SUBMISSION_REWARD', '10.05', '2026-10-31T23:59:59.999Z');
    await f.earning('REWARD', '0.10', '2026-11-01T00:00:00.000Z');
    for (const type of ['TOP_UP', 'REFUND', 'PAYMENT', 'PENALTY', 'ADJUSTMENT'] as const) await f.earning(type, '999.00', '2026-10-12T00:00:00Z');
    for (const status of ['PENDING', 'FAILED', 'REVERSED', 'CANCELLED'] as const) await f.earning('REWARD', '999.00', '2026-10-12T00:00:00Z', status);
    await f.earning('REWARD', '999.00', '2026-10-12T00:00:00Z', 'POSTED', false);
    const other = await fixture();
    await other.earning('REWARD', '777.00', '2026-10-12T00:00:00Z');
    const result = await service.list(f.client.id, f.rider.id, query({ from: '2026-10-01', to: '2026-10-31' }));
    expect(result.summary).toEqual([{ currency: 'INR', allTimeAmount: '160.45', periodAmount: '60.25' }]);
    expect(result.items.map(row => row.transactionType)).toEqual(['SELF_SUBMISSION_REWARD', 'REFERRAL_REWARD']);
    expect(result.meta.total).toBe(2);
    await expect(service.list(f.client.id, other.rider.id, query())).rejects.toThrow('Rider not found');
    const sameClientRider = await db.rider.create({ data: { clientId: f.client.id, name: 'Other', mobile: '9876543211' } });
    expect((await service.list(f.client.id, sameClientRider.id, query())).meta.total).toBe(0);
    const filtered = await service.list(f.client.id, f.rider.id, query({ type: 'REFERRAL_REWARD', pageSize: 1 }));
    expect(filtered.summary[0]).toMatchObject({ allTimeAmount: '160.45', periodAmount: '50.20' });
    expect(filtered.items).toHaveLength(1);
    const secondPage = await service.list(f.client.id, f.rider.id, query({ pageSize: 1, page: 2 }));
    expect(secondPage.items[0].transactionType).toBe('SELF_SUBMISSION_REWARD');
    expect(secondPage.meta.total).toBe(4);
    expect((await service.list(f.client.id, f.rider.id, query({ page: 100 }))).items).toEqual([]);
  });
  it('keeps currencies separate and reads riders without a wallet without creating financial records', async () => {
    const f = await fixture();
    await f.earning('REWARD', '10.01', '2026-10-01T00:00:00Z');
    const usd = await db.riderWallet.create({ data: { clientId: f.client.id, riderId: f.rider.id, currency: 'USD' } });
    const usdReward = await db.walletAccount.create({ data: { clientId: f.client.id, walletId: usd.id, currency: 'USD', accountType: 'REWARD' } });
    const usdClearing = await db.walletAccount.create({ data: { clientId: f.client.id, walletId: usd.id, currency: 'USD', accountType: 'CLEARING' } });
    const usdTransaction = await db.walletTransaction.create({ data: { clientId: f.client.id, walletId: usd.id, currency: 'USD', transactionNumber: randomUUID(), transactionType: 'REWARD', status: 'POSTED', amount: '7.13', description: 'USD reward', idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), postedAt: new Date('2026-10-01T00:00:00Z') } });
    await db.walletLedgerEntry.createMany({ data: [
      { clientId: f.client.id, walletId: usd.id, transactionId: usdTransaction.id, accountId: usdReward.id, entryType: 'CREDIT', currency: 'USD', amount: '7.13', sequence: 1 },
      { clientId: f.client.id, walletId: usd.id, transactionId: usdTransaction.id, accountId: usdClearing.id, entryType: 'DEBIT', currency: 'USD', amount: '7.13', sequence: 2 },
    ] });
    expect((await service.list(f.client.id, f.rider.id, query())).summary).toEqual([
      { currency: 'INR', allTimeAmount: '10.01', periodAmount: '10.01' }, { currency: 'USD', allTimeAmount: '7.13', periodAmount: '7.13' },
    ]);
    const rider = await db.rider.create({ data: { clientId: f.client.id, name: 'No wallet', mobile: '9876543212' } });
    const result = await service.list(f.client.id, rider.id, query());
    expect(result.items).toEqual([]); expect(result.summary).toEqual([]);
    expect(await db.riderWallet.count({ where: { riderId: rider.id } })).toBe(0);
    await db.rider.update({ where: { id: rider.id }, data: { deletedAt: new Date() } });
    await expect(service.list(f.client.id, rider.id, query())).rejects.toThrow('Rider not found');
  });
  it('reuses wallet balances with cash, rewards, deposits and partially captured holds', async () => {
    const f = await fixture();
    await f.earning('REWARD', '100.00', '2026-10-01T00:00:00Z');
    const cash = await db.walletAccount.create({ data: { clientId: f.client.id, walletId: f.wallet.id, accountType: 'CASH', currency: 'INR' } });
    const deposit = await db.walletAccount.create({ data: { clientId: f.client.id, walletId: f.wallet.id, accountType: 'SECURITY_DEPOSIT', currency: 'INR' } });
    const post = async (type: WalletTransactionType, amount: string, accountId: string, entryType: 'CREDIT' | 'DEBIT', status: WalletTransactionStatus = 'POSTED', createdAt = '2026-10-10T00:00:00Z') => {
      const row = await db.walletTransaction.create({ data: { clientId: f.client.id, walletId: f.wallet.id, transactionType: type, status, transactionNumber: randomUUID(), idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), currency: 'INR', amount, description: 'Wallet test', createdAt: new Date(createdAt), postedAt: status === 'POSTED' || status === 'REVERSED' ? new Date(createdAt) : null } });
      await db.walletLedgerEntry.createMany({ data: [
        { clientId: f.client.id, walletId: f.wallet.id, accountId, transactionId: row.id, amount, currency: 'INR', entryType, sequence: 1 },
        { clientId: f.client.id, walletId: f.wallet.id, accountId: f.clearing.id, transactionId: row.id, amount, currency: 'INR', entryType: entryType === 'CREDIT' ? 'DEBIT' : 'CREDIT', sequence: 2 },
      ] });
      return row;
    };
    await post('TOP_UP', '500.00', cash.id, 'CREDIT');
    await post('RENTAL', '200.00', cash.id, 'DEBIT');
    await post('SECURITY_DEPOSIT', '300.00', deposit.id, 'CREDIT');
    await post('TOP_UP', '25.00', cash.id, 'CREDIT', 'REVERSED');
    await post('REVERSAL', '25.00', cash.id, 'DEBIT');
    const pending = await post('TOP_UP', '999.00', cash.id, 'CREDIT', 'PENDING');
    await db.walletHold.createMany({ data: [
      { clientId: f.client.id, walletId: f.wallet.id, accountId: cash.id, amount: '50.00', capturedAmount: '10.00', currency: 'INR', reason: 'Hold', idempotencyKey: randomUUID() },
      { clientId: f.client.id, walletId: f.wallet.id, accountId: f.reward.id, amount: '20.00', currency: 'INR', reason: 'Hold', idempotencyKey: randomUUID() },
    ] });
    const before = await db.walletTransaction.count({ where: { clientId: f.client.id } });
    const balance = await wallets.balance(f.client.id, f.rider.id);
    expect(balance.wallets[0]).toMatchObject({ totalBalance: '400.00', heldBalance: '60.00', availableBalance: '340.00', cash: { totalBalance: '300.00', heldBalance: '40.00', availableBalance: '260.00' }, rewards: { totalBalance: '100.00', availableBalance: '80.00' }, securityDepositBucket: { totalBalance: '300.00' } });
    const history = await wallets.transactions(f.client.id, f.rider.id, new RiderWalletTransactionsQueryDto());
    expect(history.meta.total).toBe(before);
    expect(history.items.find(row => row.transactionType === 'RENTAL')?.movements).toEqual([{ bucket: 'CASH', amount: '-200.00' }]);
    expect(history.items.find(row => row.id === pending.id)?.movements).toEqual([]);
    const filtered = await wallets.transactions(f.client.id, f.rider.id, Object.assign(new RiderWalletTransactionsQueryDto(), { type: 'TOP_UP', status: 'PENDING', from: '2026-10-10', to: '2026-10-10', pageSize: 1 }));
    expect(filtered.meta.total).toBe(1); expect(filtered.items[0].id).toBe(pending.id);
    const nextDay = await wallets.transactions(f.client.id, f.rider.id, Object.assign(new RiderWalletTransactionsQueryDto(), { from: '2026-10-11', to: '2026-10-11' }));
    expect(nextDay.items).toEqual([]);
    expect((await service.list(f.client.id, f.rider.id, query())).summary[0].allTimeAmount).toBe('100.00');
    expect(await db.walletTransaction.count({ where: { clientId: f.client.id } })).toBe(before);
  });
  it('protects both wallet views across clients and does not create a missing wallet', async () => {
    const f = await fixture(), other = await fixture();
    await expect(wallets.balance(f.client.id, other.rider.id)).rejects.toThrow('Rider not found');
    await expect(wallets.transactions(f.client.id, other.rider.id, new RiderWalletTransactionsQueryDto())).rejects.toThrow('Rider not found');
    const noWallet = await db.rider.create({ data: { clientId: f.client.id, name: 'No wallet', mobile: '9876543222' } });
    expect((await wallets.balance(f.client.id, noWallet.id)).wallets).toEqual([]);
    expect((await wallets.transactions(f.client.id, noWallet.id, new RiderWalletTransactionsQueryDto())).meta.total).toBe(0);
    expect(await db.riderWallet.count({ where: { riderId: noWallet.id } })).toBe(0);
    await db.rider.update({ where: { id: noWallet.id }, data: { deletedAt: new Date() } });
    await expect(wallets.balance(f.client.id, noWallet.id)).rejects.toThrow('Rider not found');
    await expect(wallets.transactions(f.client.id, noWallet.id, new RiderWalletTransactionsQueryDto())).rejects.toThrow('Rider not found');
  });

  it('merges historical deployment receipts with ledger activity, without changing balances', async () => {
    const f = await fixture(), other = await fixture();
    const suffix = randomUUID();
    const oem = await db.oem.create({ data: { code: suffix, name: suffix, displayName: suffix } });
    const category = await db.vehicleCategory.create({ data: { code: suffix, name: suffix } });
    const type = await db.vehicleType.create({ data: { code: suffix, name: suffix, categoryId: category.id, energyType: 'ELECTRIC' } });
    const fleet = await db.fleet.create({ data: { clientId: f.client.id, fleetCode: suffix, chassisNumber: suffix,
      oemId: oem.id, vehicleCategoryId: category.id, vehicleTypeId: type.id, speedType: 'SLOW_SPEED' } });
    async function deployment(status: 'PAID' | 'PENDING', amount: string, riderId = f.rider.id, clientId = f.client.id, currency = 'INR') {
      const allocation = await db.allocation.create({ data: { clientId, riderId, fleetId: fleet.id, initiatedById: 'SYSTEM' } });
      const workflow = await db.mobileDeploymentWorkflow.create({ data: { clientId, allocationId: allocation.id } });
      return db.deploymentPayment.create({ data: { clientId, workflowId: workflow.id, status, amount, currency, breakdown: {},
        createdAt: new Date('2026-10-01T00:00:00Z'), paidAt: status === 'PAID' ? new Date('2026-10-02T00:00:00Z') : null } });
    }
    const paid = await deployment('PAID', '1200.10');
    await deployment('PENDING', '777.00');
    await deployment('PAID', '0.00');
    await deployment('PAID', '888.00', other.rider.id, other.client.id);
    const sibling = await db.rider.create({ data: { clientId: f.client.id, name: 'Sibling', mobile: suffix } });
    await deployment('PAID', '999.00', sibling.id);
    const reward = await f.earning('REWARD', '10.10', '2026-10-03T00:00:00Z');
    const ledger = new WalletService(db as never);
    const before = await ledger.balance(f.client.id, f.wallet.id);
    const count = await db.walletTransaction.count({ where: { clientId: f.client.id } });
    const page = (values = {}) => wallets.transactions(f.client.id, f.rider.id, Object.assign(new RiderWalletTransactionsQueryDto(), values));
    const first = await page({ pageSize: 1 });
    const second = await page({ pageSize: 1, page: 2 });
    expect(first.meta.total).toBe(2);
    expect(first.items[0].id).toBe(reward.id);
    expect(second.items[0]).toMatchObject({ id: `deployment:${paid.id}`, amount: '1200.10', transactionType: 'PAYMENT', status: 'POSTED',
      referenceType: 'DEPLOYMENT_PAYMENT', referenceId: paid.id, affectsBalance: false, movements: [] });
    expect((await page({ page: 3, pageSize: 1 })).items).toEqual([]);
    expect((await page({ type: 'PAYMENT', status: 'POSTED', from: '2026-10-01', to: '2026-10-01' })).items).toHaveLength(1);
    expect((await page({ from: '2026-10-02', to: '2026-10-02' })).items).toEqual([]);
    expect((await page({ status: 'PENDING' })).items).toEqual([]);
    expect(await ledger.transactions(f.client.id, f.wallet.id, 2, 1)).toEqual(second.items);
    expect(await ledger.transaction(f.client.id, f.wallet.id, `deployment:${paid.id}`)).toEqual(second.items[0]);
    expect(await ledger.transaction(other.client.id, other.wallet.id, `deployment:${paid.id}`)).toBeNull();
    expect(await ledger.balance(f.client.id, f.wallet.id)).toEqual(before);
    expect(await db.walletTransaction.count({ where: { clientId: f.client.id } })).toBe(count);
    await deployment('PAID', '5.00', f.rider.id, f.client.id, 'USD');
    expect(await ledger.transactions(f.client.id, f.wallet.id, 1, 20)).toHaveLength(2);
    expect((await page()).meta.total).toBe(3);
    const snapshot = { currency: 'INR', rental: { period: 'WEEKLY' }, totals: { firstRentalUpfront: '500.00', nonRefundableUpfrontAmount: '700.10' },
      recurringCharges: [{ grossAmount: '500.00' }], oneTimeCharges: [{ type: 'ONBOARDING_FEE', grossAmount: '200.10' }] };
    const common = { clientId: f.client.id, riderId: f.rider.id, vehicleId: fleet.id, rateCardId: 'historical', rateCardVersionId: 'historical',
      rentalPeriodType: 'WEEKLY' as const, currency: 'INR', finalRecurringAmount: '500.00', upfrontAmount: '1200.10', refundableAmount: '500.00',
      pricingSnapshot: snapshot, termsVersion: '1', termsTitle: 'Terms', termsSnapshot: 'Accepted', termsHash: 'a'.repeat(64), createdById: 'SYSTEM' };
    const offer = await db.riderCommercialOffer.create({ data: { ...common, offerNumber: randomUUID(), effectiveDate: new Date(),
      calculationHash: 'a'.repeat(64), selectionHash: 'a'.repeat(64), expiresAt: new Date('2030-01-01') } });
    const agreement = await db.riderRentalAgreement.create({ data: { ...common, commercialOfferId: offer.id, agreementNumber: randomUUID(),
      pricingHash: 'a'.repeat(64), pricingSnapshotSchemaVersion: 1, acceptedAt: new Date(), acceptedById: 'SYSTEM', acceptanceMethod: 'OPERATIONS_ASSISTED' } });
    const deposit = await db.riderDeposit.create({ data: { clientId: f.client.id, riderId: f.rider.id, agreementId: agreement.id,
      obligationKey: 'security', depositType: 'RIDER_SECURITY', code: 'SECURITY', currency: 'INR', originalRequiredAmount: '500', requiredAmount: '500',
      fundedAmount: '300', availableAmount: '300', status: 'PARTIALLY_REFUNDED', sourceId: agreement.id, snapshotLine: {} } });
    await db.deploymentPayment.update({ where: { id: paid.id }, data: { breakdown: { agreementId: agreement.id, pricingHash: 'a'.repeat(64), currency: 'INR',
      total: '1200.10', nonRefundableAmount: '700.10', deposits: [{ id: deposit.id, amount: '500.00' }] } } });
    const transaction = { clientId: f.client.id, riderId: f.rider.id, agreementId: agreement.id, depositId: deposit.id, currency: 'INR' };
    await db.riderDepositTransaction.create({ data: { ...transaction, transactionType: 'COLLECTION', amount: '500', balanceDelta: '500', fundingDelta: '500',
      balanceBefore: '0', balanceAfter: '500', referenceType: 'DEPLOYMENT_PAYMENT', referenceId: paid.id } });
    const refund = await db.riderDepositTransaction.create({ data: { ...transaction, transactionType: 'REFUND', amount: '200', balanceDelta: '-200', fundingDelta: '-200', balanceBefore: '500', balanceAfter: '300' } });
    const updatedBalance = await wallets.balance(f.client.id, f.rider.id);
    expect(updatedBalance.deposits[0]).toMatchObject({ status: 'PARTIALLY_REFUNDED', paidAmount: '500.00', refundedAmount: '200.00', remainingAmount: '300.00' });
    expect(updatedBalance.wallets[0].totalBalance).toBe(before.totalBalance);
    const detailed = await ledger.transaction(f.client.id, f.wallet.id, `deployment:${paid.id}`);
    expect(detailed).toMatchObject({ breakdown: { status: 'AVAILABLE', items: [
      { type: 'SECURITY_DEPOSIT', amount: '500.00' }, { type: 'ONBOARDING_FEE', amount: '200.10' }, { type: 'RENTAL', amount: '500.00' },
    ] } });
    const refundEntry = await ledger.transaction(f.client.id, f.wallet.id, `deposit-refund:${refund.id}`);
    expect(refundEntry).toMatchObject({ status: 'POSTED', transactionType: 'SECURITY_DEPOSIT_REFUND', amount: '200.00', affectsBalance: false, movements: [], depositId: deposit.id, deploymentPaymentIds: [paid.id] });
    expect(await ledger.transaction(other.client.id, other.wallet.id, `deposit-refund:${refund.id}`)).toBeNull();
    expect((await page({ type: 'SECURITY_DEPOSIT_REFUND' })).meta.total).toBe(1);
    await db.riderDepositTransaction.create({ data: { ...transaction, transactionType: 'REVERSAL', amount: '200', balanceDelta: '200', fundingDelta: '200', balanceBefore: '300', balanceAfter: '500', reversalOfTransactionId: refund.id } });
    await db.riderDeposit.update({ where: { id: deposit.id }, data: { status: 'HELD', fundedAmount: '500', availableAmount: '500' } });
    expect((await wallets.balance(f.client.id, f.rider.id)).deposits[0]).toMatchObject({ status: 'HELD', paidAmount: '500.00', refundedAmount: '0.00', remainingAmount: '500.00' });
    expect(await ledger.transaction(f.client.id, f.wallet.id, `deposit-refund:${refund.id}`)).toMatchObject({ status: 'REVERSED' });
    expect(await db.walletTransaction.count({ where: { clientId: f.client.id } })).toBe(count);

  });

});
