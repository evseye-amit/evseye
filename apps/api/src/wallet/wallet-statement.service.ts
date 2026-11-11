import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const visibleBuckets = ['CASH', 'REWARD', 'SECURITY_DEPOSIT'] as const;
type Bucket = (typeof visibleBuckets)[number];
const zero = () => new Prisma.Decimal(0);
const pageNumber = (value: string | undefined, fallback: number, max: number) => {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new BadRequestException('INVALID_PAGINATION');
  return parsed;
};

@Injectable()
export class WalletStatementService {
  constructor(private readonly prisma: PrismaService) {}

  period(from?: string, to?: string) {
    const now = new Date();
    const first = from ?? `${now.toISOString().slice(0, 7)}-01`;
    const last = to ?? now.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) throw new BadRequestException('INVALID_STATEMENT_PERIOD');
    const start = new Date(`${first}T00:00:00.000Z`);
    const end = new Date(`${last}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.toISOString().slice(0, 10) !== first || end.toISOString().slice(0, 10) !== last || end < start || end.getTime() - start.getTime() > 366 * 86400000 || end > now) throw new BadRequestException('INVALID_STATEMENT_PERIOD');
    return { from: first, to: last, start, exclusiveEnd: new Date(end.getTime() + 86400000) };
  }

  async statement(clientId: string, walletId: string, from?: string, to?: string, p?: string, s?: string) {
    const period = this.period(from, to);
    const page = pageNumber(p, 1, 1000000);
    const pageSize = pageNumber(s, 25, 100);
    const wallet = await this.prisma.riderWallet.findFirst({ where: { id: walletId, clientId }, include: { accounts: true, rider: { select: { name: true, mobile: true, riderCode: true } }, client: { select: { name: true } } } });
    if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
    const accountTypes = new Map(wallet.accounts.filter(a => visibleBuckets.includes(a.accountType as Bucket)).map(a => [a.id, a.accountType as Bucket]));
    const base = { clientId, walletId, accountId: { in: [...accountTypes.keys()] }, transaction: { status: { in: ['POSTED', 'REVERSED'] as ('POSTED' | 'REVERSED')[] }, postedAt: { lt: period.exclusiveEnd } } };
    const [openingGroups, periodGroups, transactions, total] = await Promise.all([
      this.prisma.walletLedgerEntry.groupBy({ by: ['accountId', 'entryType'], where: { ...base, transaction: { ...base.transaction, postedAt: { lt: period.start } } }, _sum: { amount: true } }),
      this.prisma.walletLedgerEntry.groupBy({ by: ['accountId', 'entryType'], where: { ...base, transaction: { ...base.transaction, postedAt: { gte: period.start, lt: period.exclusiveEnd } } }, _sum: { amount: true } }),
      this.prisma.walletTransaction.findMany({ where: { clientId, walletId, status: { in: ['POSTED', 'REVERSED'] }, postedAt: { gte: period.start, lt: period.exclusiveEnd }, entries: { some: { accountId: { in: [...accountTypes.keys()] } } } }, orderBy: [{ postedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, transactionNumber: true, transactionType: true, status: true, description: true, postedAt: true, referenceType: true, referenceId: true, entries: { select: { accountId: true, entryType: true, amount: true } } } }),
      this.prisma.walletTransaction.count({ where: { clientId, walletId, status: { in: ['POSTED', 'REVERSED'] }, postedAt: { gte: period.start, lt: period.exclusiveEnd }, entries: { some: { accountId: { in: [...accountTypes.keys()] } } } } }),
    ]);
    const buckets = Object.fromEntries(visibleBuckets.map(type => [type, { opening: zero(), credits: zero(), debits: zero() }])) as Record<Bucket, { opening: Prisma.Decimal; credits: Prisma.Decimal; debits: Prisma.Decimal }>;
    for (const group of openingGroups) { const type = accountTypes.get(group.accountId); if (type) buckets[type].opening = buckets[type].opening.plus(group.entryType === 'CREDIT' ? group._sum?.amount ?? zero() : (group._sum?.amount ?? zero()).neg()); }
    for (const group of periodGroups) { const type = accountTypes.get(group.accountId); if (type) { const key = group.entryType === 'CREDIT' ? 'credits' : 'debits'; buckets[type][key] = buckets[type][key].plus(group._sum?.amount ?? zero()); } }
    const render = (types: Bucket[]) => {
      const opening = types.reduce((sum, type) => sum.plus(buckets[type].opening), zero());
      const credits = types.reduce((sum, type) => sum.plus(buckets[type].credits), zero());
      const debits = types.reduce((sum, type) => sum.plus(buckets[type].debits), zero());
      return { opening: opening.toFixed(2), credits: credits.toFixed(2), debits: debits.toFixed(2), closing: opening.plus(credits).minus(debits).toFixed(2) };
    };
    return { reference: createHash('sha256').update(`${clientId}:${walletId}:${period.from}:${period.to}`).digest('hex').slice(0, 20).toUpperCase(), period: { from: period.from, to: period.to, timezone: 'UTC' }, currency: wallet.currency, clientName: wallet.client.name, rider: { name: wallet.rider.name, riderCode: wallet.rider.riderCode, maskedMobile: wallet.rider.mobile.replace(/.(?=.{4})/g, '*') }, spendable: render(['CASH', 'REWARD']), buckets: Object.fromEntries(visibleBuckets.map(type => [type, render([type])])), transactions: transactions.map(transaction => ({ id: transaction.id, number: transaction.transactionNumber, type: transaction.transactionType, status: transaction.status, description: transaction.description, postedAt: transaction.postedAt, referenceType: transaction.referenceType, referenceId: transaction.referenceId, movements: visibleBuckets.map(type => ({ bucket: type, amount: transaction.entries.filter(entry => accountTypes.get(entry.accountId) === type).reduce((sum, entry) => sum.plus(entry.entryType === 'CREDIT' ? entry.amount : entry.amount.neg()), zero()).toFixed(2) })).filter(movement => movement.amount !== '0.00') })), meta: { page, pageSize, total } };
  }
}
