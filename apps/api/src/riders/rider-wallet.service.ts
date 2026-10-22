import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { RiderWalletTransactionsQueryDto } from './dto/rider-wallet.dto.js';
import { riderFinancialPeriod } from './rider-financial-period.js';

@Injectable()
export class RiderWalletOperationsService {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService) {}
  private async rider(tx: Prisma.TransactionClient, clientId: string, riderId: string) {
    const rider = await tx.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true, name: true, mobile: true } });
    if (!rider) throw new NotFoundException('Rider not found.');
    return rider;
  }
  async balance(clientId: string, riderId: string) {
    return this.prisma.$transaction(async tx => {
      const rider = await this.rider(tx, clientId, riderId);
      const wallets = await tx.riderWallet.findMany({ where: { clientId, riderId }, orderBy: { currency: 'asc' }, select: { id: true, status: true } });
      const balances = await Promise.all(wallets.map(async row => ({ id: row.id, status: row.status, ...await this.wallet.balanceTx(tx, clientId, row.id) })));
      return { rider, wallets: balances, transactionTypes: Object.values(WalletTransactionType), transactionStatuses: Object.values(WalletTransactionStatus) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async transactions(clientId: string, riderId: string, query: RiderWalletTransactionsQueryDto) {
    const { from, end } = riderFinancialPeriod(query.from, query.to);
    return this.prisma.$transaction(async tx => {
      const rider = await this.rider(tx, clientId, riderId);
      const where: Prisma.WalletTransactionWhereInput = { clientId, wallet: { clientId, riderId },
        ...(query.type ? { transactionType: query.type } : {}), ...(query.status ? { status: query.status } : {}),
        ...(from || end ? { createdAt: { ...(from ? { gte: from } : {}), ...(end ? { lt: end } : {}) } } : {}),
      };
      const [items, total] = await Promise.all([
        tx.walletTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, transactionNumber: true, transactionType: true, status: true, amount: true, currency: true, description: true, referenceType: true, referenceId: true, createdAt: true, postedAt: true,
            entries: { where: { clientId, account: { clientId, accountType: { in: ['CASH', 'REWARD', 'SECURITY_DEPOSIT'] } } }, select: { amount: true, entryType: true, account: { select: { accountType: true } } } } },
        }), tx.walletTransaction.count({ where }),
      ]);
      return { rider, transactionTypes: Object.values(WalletTransactionType), transactionStatuses: Object.values(WalletTransactionStatus), items: items.map(({ entries, ...row }) => ({ ...row, amount: row.amount.toFixed(2),
        movements: (['POSTED', 'REVERSED'].includes(row.status) ? ['CASH', 'REWARD', 'SECURITY_DEPOSIT'] : []).map(bucket => ({ bucket,
          amount: entries.filter(entry => entry.account.accountType === bucket).reduce((sum, entry) => sum.plus(entry.entryType === 'CREDIT' ? entry.amount : entry.amount.neg()), new Prisma.Decimal(0)).toFixed(2),
        })).filter(entry => entry.amount !== '0.00'),
      })), meta: { page: query.page, pageSize: query.pageSize, total } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
