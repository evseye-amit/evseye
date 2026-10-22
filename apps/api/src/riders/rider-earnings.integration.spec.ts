import { RiderWalletOperationsService } from './rider-wallet.service.js';
import { RiderWalletTransactionsQueryDto } from './dto/rider-wallet.dto.js';
import { WalletService } from '../wallet/wallet.service.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, type WalletTransactionStatus, type WalletTransactionType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RiderEarningsService } from './rider-earnings.service.js';
import { RiderEarningsQueryDto } from './dto/rider-earnings.dto.js';

const url = process.env.RIDER_EARNINGS_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.includes('_test_')) throw new Error('Use a disposable _test_ database.');
const db = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://unused:unused@localhost:5432/unused' } } });
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

});
