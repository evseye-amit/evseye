import { riderDepositSummary } from '../wallet/rider-deposit-summary.js';
import { transactionHistory } from '../wallet/transaction-history.js';
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
      return { rider, deposits: await riderDepositSummary(tx, clientId, riderId), wallets: balances, transactionTypes: Object.values(WalletTransactionType), transactionStatuses: Object.values(WalletTransactionStatus) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async transactions(clientId: string, riderId: string, query: RiderWalletTransactionsQueryDto) {
    const { from, end } = riderFinancialPeriod(query.from, query.to);
    return this.prisma.$transaction(async tx => {
      const rider = await this.rider(tx, clientId, riderId);
      const history = await transactionHistory(tx, { clientId, riderId, ...query, from, end });
      return { rider, transactionTypes: Object.values(WalletTransactionType), transactionStatuses: Object.values(WalletTransactionStatus), ...history };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
