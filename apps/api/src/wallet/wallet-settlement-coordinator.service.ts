import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { WalletBillingService } from './wallet-billing.service.js';

/** Recovers settlement independently of whether the rider enables bank funding. */
@Injectable()
export class WalletSettlementCoordinator implements OnModuleInit {
  private readonly logger = new Logger(WalletSettlementCoordinator.name);
  constructor(private readonly db: PrismaService, private readonly wallet: WalletService, private readonly billing: WalletBillingService) {}
  onModuleInit() { this.wallet.onCommittedBalanceChange(id => this.settle(id)); }
  async settle(walletId: string) {
    const wallet = await this.db.riderWallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.status !== 'ACTIVE') return;
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${wallet.riderId} AND "clientId"=${wallet.clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${wallet.id} FOR UPDATE`;
      const profile = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId: wallet.clientId, riderId: wallet.riderId } } });
      if (profile?.collectionMode !== 'LEDGER_WALLET') return;
      await tx.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementCheckedAt: new Date() } });
      const invoices = await tx.riderInvoice.findMany({ where: { clientId: wallet.clientId, riderId: wallet.riderId, currency: wallet.currency,
        invoiceType: { not: 'SECURITY_DEPOSIT' }, status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] }, outstandingAmount: { gt: 0 } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 50 });
      for (const invoice of invoices) {
        // A pending checkout/legacy debit owns its settlement until reconciled.
        const pending = await tx.paymentCollectionRequest.findFirst({ where: { clientId: wallet.clientId, riderId: wallet.riderId, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] }, OR: [{ invoiceId: invoice.id }, { collectionType: { in: ['OUTSTANDING_PAYMENT', 'SUBMISSION_PENALTY_PAYMENT'] } }] } });
        const debit = await tx.paymentTransaction.findFirst({ where: { clientId: wallet.clientId, invoiceId: invoice.id, status: { in: ['CREATING', 'PENDING', 'UNKNOWN'] } } });
        if (pending || debit) continue;
        const sequence = await tx.walletInvoiceAllocation.count({ where: { clientId: wallet.clientId, invoiceId: invoice.id } });
        await this.billing.settleInTransaction(tx, wallet.clientId, invoice.id, 'SYSTEM', `ledger:${invoice.id}:${sequence}`, wallet);
      }
    }, { timeout: 20000 });
  }
  @Cron(CronExpression.EVERY_MINUTE)
  async recover() {
    const profiles = await this.db.riderPaymentProfile.findMany({ where: { collectionMode: 'LEDGER_WALLET' }, orderBy: [{ walletSettlementCheckedAt: 'asc' }, { id: 'asc' }], take: 100 });
    for (const profile of profiles) {
      // Mark scanned even for a missing wallet, so malformed records cannot starve the queue.
      await this.db.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementCheckedAt: new Date() } });
      const wallet = await this.db.riderWallet.findUnique({ where: { clientId_riderId_currency: { clientId: profile.clientId, riderId: profile.riderId, currency: profile.currency } } });
      if (wallet) try { await this.settle(wallet.id); } catch { this.logger.warn(`Wallet settlement pending: ${wallet.id}`); }
    }
  }
}
