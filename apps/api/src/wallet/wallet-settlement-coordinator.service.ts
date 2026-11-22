import { rentalCollectionEnabled, rentalClientEnabled } from '../rider-billing/rental-billing-policy.js';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { WalletBillingService } from './wallet-billing.service.js';

/** Recovers settlement independently of whether the rider enables bank funding. */
@Injectable()
export class WalletSettlementCoordinator implements OnModuleInit {
  private recovering = false;
  private readonly logger = new Logger(WalletSettlementCoordinator.name);
  constructor(private readonly db: PrismaService, private readonly wallet: WalletService, private readonly billing: WalletBillingService) {}
  onModuleInit() { this.wallet.onCommittedBalanceChange(id => this.settle(id)); }
  async settle(walletId: string) {
    const wallet = await this.db.riderWallet.findUnique({ where: { id: walletId } });
    if (!rentalCollectionEnabled() || (wallet && !rentalClientEnabled(wallet.clientId))) return;
    if (!wallet || wallet.status !== 'ACTIVE') return;
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${wallet.riderId} AND "clientId"=${wallet.clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "RiderWallet" WHERE id=${wallet.id} FOR UPDATE`;
      const profile = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId: wallet.clientId, riderId: wallet.riderId } } });
      if (profile?.collectionMode !== 'LEDGER_WALLET' && !profile?.autoSettleInvoiceFromWallet) return;
      await tx.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementCheckedAt: new Date() } });
      const unapplied = await tx.riderPayment.count({ where: { clientId: wallet.clientId, riderId: wallet.riderId, currency: wallet.currency, status: 'CONFIRMED', method: { not: 'DEPLOYMENT' }, unallocatedAmount: { gt: 0 } } });
      if (unapplied) throw new Error('UNALLOCATED_PAYMENT_REVIEW_REQUIRED');
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
    if (!rentalCollectionEnabled() || this.recovering) return;
    this.recovering = true;
    try {
      const profiles = await this.db.riderPaymentProfile.findMany({ where: { OR: [{ collectionMode: 'LEDGER_WALLET' }, { autoSettleInvoiceFromWallet: true }] }, orderBy: [{ walletSettlementCheckedAt: 'asc' }, { id: 'asc' }], take: 100 });
      for (const profile of profiles) {
        try {
          await this.db.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementCheckedAt: new Date() } });
          if (!rentalClientEnabled(profile.clientId)) continue;
          const wallet = await this.db.riderWallet.findUnique({ where: { clientId_riderId_currency: { clientId: profile.clientId, riderId: profile.riderId, currency: profile.currency } } })
            ?? (profile.currency === 'INR' ? await this.wallet.ensure(profile.clientId, profile.riderId) : null);
          if (!wallet) throw new Error('LEDGER_NOT_INITIALIZED');
          await this.settle(wallet.id);
          await this.db.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementSuccessAt: new Date(), walletSettlementLastError: null } });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : 'COLLECTION_FAILED';
          this.logger.warn(`Ledger settlement pending: ${profile.id} ${message}`);
          try { await this.db.riderPaymentProfile.update({ where: { id: profile.id }, data: { walletSettlementLastError: message } }); } catch { /* Continue other riders if this record cannot be updated. */ }
        }
      }
    } finally { this.recovering = false; }
  }
}
