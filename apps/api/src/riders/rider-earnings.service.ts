import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderEarningsQueryDto, riderEarningTypes } from './dto/rider-earnings.dto.js';

function boundary(value?: string) {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('Choose a valid earnings date (YYYY-MM-DD).');
  return date;
}

@Injectable()
export class RiderEarningsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(clientId: string, riderId: string, query: RiderEarningsQueryDto) {
    const from = boundary(query.from);
    const to = boundary(query.to);
    if (from && to && from > to) throw new BadRequestException('From date must not be after To date.');
    const end = to ? new Date(to.getTime() + 86400000) : undefined;
    return this.prisma.$transaction(async tx => {
      const rider = await tx.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true, name: true, mobile: true } });
      if (!rider) throw new NotFoundException('Rider not found.');
      const base: Prisma.WalletTransactionWhereInput = {
        clientId, wallet: { clientId, riderId }, status: 'POSTED', amount: { gt: 0 },
        transactionType: { in: [...riderEarningTypes] }, postedAt: { not: null },
        entries: { some: { clientId, entryType: 'CREDIT', account: { clientId, accountType: 'REWARD' } } },
      };
      const where: Prisma.WalletTransactionWhereInput = {
        ...base,
        ...(query.type ? { transactionType: query.type } : {}),
        postedAt: { not: null, ...(from ? { gte: from } : {}), ...(end ? { lt: end } : {}) },
      };
      const [items, total, allTime, period, wallets] = await Promise.all([
        tx.walletTransaction.findMany({ where, orderBy: [{ postedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, transactionNumber: true, transactionType: true, description: true, currency: true, amount: true, referenceType: true, referenceId: true, postedAt: true } }),
        tx.walletTransaction.count({ where }),
        tx.walletTransaction.groupBy({ by: ['currency'], where: base, _sum: { amount: true } }),
        tx.walletTransaction.groupBy({ by: ['currency'], where, _sum: { amount: true } }),
        tx.riderWallet.findMany({ where: { clientId, riderId }, select: { currency: true } }),
      ]);
      const currencies = [...new Set([...wallets, ...allTime, ...period].map(row => row.currency))].sort();
      return {
        rider,
        summary: currencies.map(currency => ({ currency,
          allTimeAmount: allTime.find(row => row.currency === currency)?._sum.amount?.toFixed(2) ?? '0.00',
          periodAmount: period.find(row => row.currency === currency)?._sum.amount?.toFixed(2) ?? '0.00',
        })),
        items: items.map(row => ({ ...row, amount: row.amount.toFixed(2) })),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
