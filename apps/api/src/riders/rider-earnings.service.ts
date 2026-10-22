import { riderFinancialPeriod } from './rider-financial-period.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderEarningsQueryDto, riderEarningTypes } from './dto/rider-earnings.dto.js';

@Injectable()
export class RiderEarningsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(clientId: string, riderId: string, query: RiderEarningsQueryDto) {
    const { from, end } = riderFinancialPeriod(query.from, query.to);
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
