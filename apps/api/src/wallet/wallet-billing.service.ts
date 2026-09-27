import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RiderInvoice, type WalletAccountType, WalletTransactionType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseSnapshot } from '../rider-rate-cards/commercial-snapshot.js';
import { WalletService } from './wallet.service.js';
import { SecurityDepositService } from './security-deposit.service.js';
import { defaultPolicy, planFunding, type ChargeCategory } from './wallet-policy.service.js';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const zero = new D(0);
const price = (value: unknown) => { if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})\.\d{2}$/.test(value)) throw new ConflictException('INVALID_PRICING_RESULT'); return new D(value); };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const day = (value: Date) => new Date(`${value.toISOString().slice(0,10)}T00:00:00.000Z`);
const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
const keyPart = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

@Injectable()
export class WalletBillingService {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService, private readonly deposits: SecurityDepositService) {}
  private async number(tx: Tx, clientId: string, at: Date) {
    const year = at.getUTCMonth() >= 3 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
    const fy = `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
    const sequence = await tx.riderInvoiceSequence.upsert({ where: { clientId_financialYear: { clientId, financialYear: fy } }, create: { clientId, financialYear: fy, lastNumber: 1 }, update: { lastNumber: { increment: 1 } } });
    return `EVS/${clientId.slice(0,8)}/${fy}/${String(sequence.lastNumber).padStart(6,'0')}`;
  }
  async generateOneTime(clientId: string, agreementId: string, actorId: string) {
    const agreement = await this.prisma.riderRentalAgreement.findFirst({ where: { clientId, id: agreementId } });
    if (!agreement) throw new NotFoundException('AGREEMENT_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, agreement.riderId, actorId);
    const issued = await this.wallet.locked(wallet.id, async tx => {
      const version = await tx.riderAgreementCommercialVersion.findFirst({ where: { clientId, agreementId, versionNumber: 1 } });
      if (!version) throw new NotFoundException('RATE_CARD_NOT_FOUND');
      const snapshot = parseSnapshot(version.pricingSnapshot, 1);
      if (snapshot.currency !== agreement.currency || version.rateCardVersionId !== agreement.rateCardVersionId) throw new ConflictException('INVALID_PRICING_RESULT');
      const start = day(agreement.startDate ?? agreement.createdAt), end = plusDays(start, 1);
      const profile = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId: agreement.riderId } } });
      const dueDate = plusDays(start, profile?.paymentTermsDays ?? 0);
      const results: RiderInvoice[] = [];
      const oneTime = (snapshot.oneTimeCharges as Record<string, unknown>[]).filter(line => line.type === 'ONBOARDING_FEE');
      if (oneTime.length) {
        const sourceKey = `agreement:${agreementId}:onboarding`;
        const existing = await tx.riderInvoice.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
        if (existing) results.push(existing);
        else {
          const priorLine = await tx.riderInvoiceLine.findFirst({ where: { clientId, chargeType: 'ONBOARDING_FEE', invoice: { agreementId } } });
          if (!priorLine) {
            const total = oneTime.reduce((sum, line) => sum.plus(price(line.grossAmount)), zero);
            const tax = oneTime.reduce((sum, line) => sum.plus(line.taxAmount ? price(line.taxAmount) : zero), zero);
            if (total.lte(0) || tax.gt(total)) throw new ConflictException('INVALID_PRICING_RESULT');
            const invoice = await tx.riderInvoice.create({ data: { clientId, riderId: agreement.riderId, agreementId, invoiceNumber: await this.number(tx, clientId, start), invoiceType: 'ONBOARDING', sourceKey, pricingSnapshot: json({ pricingHash: version.pricingHash, versionId: version.id, rateCardVersionId: version.rateCardVersionId, snapshot, lines: oneTime }), billingPeriodStart: start, billingPeriodEnd: end, subtotal: total.minus(tax), creditAmount: zero, taxAmount: tax, totalAmount: total, outstandingAmount: total, currency: agreement.currency, dueDate, issuedAt: new Date(), finalizedAt: new Date(), status: 'FINALIZED' } });
            for (const line of oneTime) {
              const amount = price(line.grossAmount);
              const code = String(line.code);
              const charge = await tx.riderCharge.create({ data: { clientId, riderId: agreement.riderId, sourceKey: `agreement:${agreementId}:one-time:${version.id}:${code}`, chargeType: 'ONBOARDING_FEE', referenceType: 'RENTAL_AGREEMENT', referenceId: agreementId, description: `Onboarding fee (${code})`, quantity: new D(1), unitAmount: amount, amount, currency: agreement.currency, effectiveAt: start, agreementId, commercialVersionId: version.id, vehicleId: version.vehicleId, pricingDetail: json({ frozenOneTimeLine: line }), status: 'INVOICED', invoiceId: invoice.id } });
              await tx.riderLedgerEntry.create({ data: { clientId, riderId: agreement.riderId, agreementId, vehicleId: version.vehicleId, entryType: 'CHARGE', sourceType: 'RIDER_CHARGE', sourceId: charge.id, description: charge.description, debitAmount: amount, currency: agreement.currency, effectiveAt: start } });
              await tx.riderInvoiceLine.create({ data: { clientId, invoiceId: invoice.id, kind: 'CHARGE', sourceId: charge.id, description: charge.description, amount, currency: agreement.currency, chargeType: 'ONBOARDING_FEE', commercialVersionId: version.id, vehicleId: version.vehicleId, quantity: new D(1), unitPrice: amount, grossAmount: amount, taxAmount: line.taxAmount ? new D(String(line.taxAmount)) : zero, pricingDetail: json(line) } });
            }
            await tx.auditLog.create({ data: { clientId, actorId, action: 'WALLET_ONBOARDING_INVOICE_ISSUED', entityType: 'RiderInvoice', entityId: invoice.id } });
            results.push(invoice);
          }
        }
      }
      const depositLines = (snapshot.deposits as Record<string, unknown>[]).filter(line => price(line.finalRequired).gt(0));
      if (depositLines.length) {
        const legacyFunding = await tx.riderDeposit.findFirst({ where: { clientId, agreementId, fundedAmount: { gt: 0 } } });
        if (legacyFunding) throw new ConflictException('EXISTING_DEPOSIT_FUNDING_REQUIRES_RECONCILIATION');
        const sourceKey = `agreement:${agreementId}:security-deposit`;
        const existing = await tx.riderInvoice.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
        if (existing) results.push(existing);
        else {
          const total = depositLines.reduce((sum, line) => sum.plus(price(line.finalRequired)), zero);
          const invoice = await tx.riderInvoice.create({ data: { clientId, riderId: agreement.riderId, agreementId, invoiceNumber: await this.number(tx, clientId, start), invoiceType: 'SECURITY_DEPOSIT', sourceKey, pricingSnapshot: json({ pricingHash: version.pricingHash, versionId: version.id, rateCardVersionId: version.rateCardVersionId, snapshot, lines: depositLines }), billingPeriodStart: start, billingPeriodEnd: end, subtotal: total, creditAmount: zero, totalAmount: total, outstandingAmount: total, currency: agreement.currency, dueDate, issuedAt: new Date(), finalizedAt: new Date(), status: 'FINALIZED' } });
          const policy = await tx.walletPolicy.findFirst({ where: { clientId, effectiveUntil: null }, orderBy: { version: 'desc' } });
          await tx.walletAccount.upsert({ where: { clientId_walletId_accountType: { clientId, walletId: wallet.id, accountType: 'SECURITY_DEPOSIT' } }, create: { clientId, walletId: wallet.id, accountType: 'SECURITY_DEPOSIT', currency: wallet.currency }, update: {} });
          for (const line of depositLines) {
            const amount = price(line.finalRequired);
            const code = String(line.code);
            const deposit = await tx.walletSecurityDeposit.upsert({ where: { clientId_riderId_sourceType_sourceId: { clientId, riderId: agreement.riderId, sourceType: 'RENTAL_AGREEMENT', sourceId: `${agreementId}:${code}` } }, create: { clientId, riderId: agreement.riderId, walletId: wallet.id, currency: wallet.currency, requiredAmount: amount, sourceType: 'RENTAL_AGREEMENT', sourceId: `${agreementId}:${code}`, policyVersion: policy?.version ?? 0, createdById: actorId }, update: {} });
            if (!deposit.requiredAmount.eq(amount) || deposit.walletId !== wallet.id) throw new ConflictException('SECURITY_DEPOSIT_REQUIREMENT_CONFLICT');
            if (new D((await this.deposits.summaryTx(tx, deposit)).fundedAmount).gt(0)) throw new ConflictException('EXISTING_DEPOSIT_FUNDING_REQUIRES_RECONCILIATION');
            await tx.riderInvoiceLine.create({ data: { clientId, invoiceId: invoice.id, kind: 'CHARGE', sourceId: deposit.id, description: `Security deposit (${code})`, amount, currency: agreement.currency, chargeType: 'SECURITY_DEPOSIT', commercialVersionId: version.id, vehicleId: version.vehicleId, pricingDetail: json(line) } });
          }
          await tx.auditLog.create({ data: { clientId, actorId, action: 'WALLET_DEPOSIT_INVOICE_ISSUED', entityType: 'RiderInvoice', entityId: invoice.id } });
          results.push(invoice);
        }
      }
      return results;
    });
    const profile = await this.prisma.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId: agreement.riderId } } });
    if (profile?.autoSettleInvoiceFromWallet) return Promise.all(issued.map(invoice => this.settle(clientId, invoice.id, actorId, `auto:${invoice.id}`)));
    return issued;
  }
  async settle(clientId: string, invoiceId: string, actorId: string, key: string) {
    const initial = await this.prisma.riderInvoice.findFirst({ where: { clientId, id: invoiceId } });
    if (!initial) throw new NotFoundException('INVOICE_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, initial.riderId, actorId);
    return this.wallet.locked(wallet.id, async tx => {
      await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${invoiceId} AND "clientId" = ${clientId} FOR UPDATE`;
      const invoice = await tx.riderInvoice.findFirst({ where: { clientId, id: invoiceId }, include: { lines: true } });
      if (!invoice) throw new NotFoundException('INVOICE_NOT_FOUND');
      const previous = await tx.walletTransaction.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
      if (previous) { if (!(await tx.walletInvoiceAllocation.findFirst({ where: { clientId, transactionId: previous.id, invoiceId } }))) throw new ConflictException('IDEMPOTENCY_CONFLICT'); return tx.riderInvoice.findUniqueOrThrow({ where: { id: invoiceId } }); }
      if (!['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) || invoice.outstandingAmount.lte(0)) throw new ConflictException('INVOICE_NOT_PAYABLE');
      if (invoice.currency !== wallet.currency) throw new ConflictException('CURRENCY_MISMATCH');
      const accounts = await tx.walletAccount.findMany({ where: { clientId, walletId: wallet.id } });
      const account = (type: WalletAccountType) => { const result = accounts.find(a => a.accountType === type && a.status === 'ACTIVE'); if (!result) throw new ConflictException('ACCOUNT_NOT_FOUND'); return result; };
      const balance = await this.wallet.balanceTx(tx, clientId, wallet.id);
      const policy = await tx.walletPolicy.findFirst({ where: { clientId, effectiveUntil: null }, orderBy: { version: 'desc' } }) ?? defaultPolicy;
      const category: ChargeCategory = invoice.invoiceType === 'ONBOARDING' ? 'ONBOARDING_FEE' : invoice.invoiceType === 'RENTAL' ? 'RENTAL' : invoice.invoiceType === 'SECURITY_DEPOSIT' ? 'SECURITY_DEPOSIT' : 'OTHER';
      const historicalReward = await tx.walletInvoiceAllocation.findMany({ where: { clientId, invoiceId, sourceType: 'REWARD' } });
      const rewardUsed = historicalReward.reduce((sum, a) => sum.plus(a.kind === 'APPLY' ? a.amount : a.amount.neg()), zero);
      const lifetimeRewardCap = D.max(invoice.totalAmount.mul(policy.maxRewardUsagePercent).div(100).toDecimalPlaces(2, D.ROUND_DOWN).minus(rewardUsed), 0);
      const plan = planFunding(invoice.outstandingAmount, category, { cash: D.max(new D(balance.cash.availableBalance).plus(policy.allowNegativeCashBalance ? policy.negativeBalanceLimit : zero), 0), reward: invoice.invoiceType === 'SECURITY_DEPOSIT' ? zero : D.min(D.max(new D(balance.rewards.availableBalance), 0), lifetimeRewardCap) }, invoice.invoiceType === 'SECURITY_DEPOSIT' ? { ...policy, allowRewardUsage: false } : policy);
      const chosen = plan.funding.filter(f => f.source !== 'EXTERNAL_PAYMENT' && new D(f.amount).gt(0));
      if (!chosen.length) return invoice;
      let used = zero;
      if (invoice.invoiceType === 'SECURITY_DEPOSIT') {
        let cashLeft = new D(chosen.find(f => f.source === 'CASH')?.amount ?? '0.00');
        for (const line of invoice.lines.filter(l => l.chargeType === 'SECURITY_DEPOSIT')) {
          if (cashLeft.lte(0)) break;
          const deposit = await tx.walletSecurityDeposit.findFirst({ where: { clientId, id: line.sourceId, walletId: wallet.id } });
          if (!deposit) throw new ConflictException('SECURITY_DEPOSIT_NOT_FOUND');
          const summary = await this.deposits.summaryTx(tx, deposit);
          const value = D.min(cashLeft, new D(summary.outstandingAmount));
          if (value.lte(0)) continue;
          const amount = value.toFixed(2);
          const transaction = await this.wallet.postInTransaction(tx, { clientId, walletId: wallet.id, actorId, type: WalletTransactionType.SECURITY_DEPOSIT, amount, currency: wallet.currency, description: `Fund deposit for invoice ${invoice.invoiceNumber}`, idempotencyKey: used.eq(0) ? key : `invoice:${keyPart(key)}:${keyPart(deposit.id)}`, referenceType: 'WALLET_SECURITY_DEPOSIT', referenceId: deposit.id, entries: [{ accountId: account('CASH').id, entryType: 'DEBIT', amount }, { accountId: account('SECURITY_DEPOSIT').id, entryType: 'CREDIT', amount }] });
          await tx.walletInvoiceAllocation.create({ data: { clientId, invoiceId, transactionId: transaction.id, sourceType: 'CASH', amount: value, currency: wallet.currency, createdById: actorId } });
          await tx.walletSecurityDeposit.update({ where: { id: deposit.id }, data: { status: value.eq(summary.outstandingAmount) ? 'PAID' : 'PARTIALLY_PAID' } });
          cashLeft = cashLeft.minus(value); used = used.plus(value);
        }
      } else {
        const amount = chosen.reduce((sum, f) => sum.plus(f.amount), zero).toFixed(2);
        const entries: { accountId: string; entryType: 'DEBIT' | 'CREDIT'; amount: string }[] = chosen.map(f => ({ accountId: account(f.source as WalletAccountType).id, entryType: 'DEBIT', amount: f.amount }));
        entries.push({ accountId: account('CLEARING').id, entryType: 'CREDIT', amount });
        const transaction = await this.wallet.postInTransaction(tx, { clientId, walletId: wallet.id, actorId, type: invoice.invoiceType === 'RENTAL' ? 'RENTAL' : invoice.invoiceType === 'ONBOARDING' ? 'ONBOARDING_FEE' : 'PAYMENT', amount, currency: wallet.currency, description: `Wallet settlement for invoice ${invoice.invoiceNumber}`, idempotencyKey: key, referenceType: 'RIDER_INVOICE', referenceId: invoice.id, entries });
        for (const source of chosen) await tx.walletInvoiceAllocation.create({ data: { clientId, invoiceId, transactionId: transaction.id, sourceType: source.source as WalletAccountType, amount: new D(source.amount), currency: wallet.currency, createdById: actorId } });
        used = new D(amount);
      }
      if (used.lte(0)) return invoice;
      const outstanding = invoice.outstandingAmount.minus(used);
      const updated = await tx.riderInvoice.update({ where: { id: invoice.id }, data: { paidAmount: invoice.paidAmount.plus(used), outstandingAmount: outstanding, status: outstanding.eq(0) ? 'PAID' : invoice.status === 'OVERDUE' ? 'OVERDUE' : 'PARTIALLY_PAID', paidAt: outstanding.eq(0) ? new Date() : null } });
      await tx.auditLog.create({ data: { clientId, actorId: actorId === 'SYSTEM' ? null : actorId, action: 'WALLET_INVOICE_SETTLED', entityType: 'RiderInvoice', entityId: invoice.id, newData: { amount: used.toFixed(2), outstanding: outstanding.toFixed(2) } } });
      return updated;
    });
  }
  async voidUnpaidOneTime(clientId: string, invoiceId: string, actorId: string, reason: string) {
    if (!reason || reason.length > 500) throw new ConflictException('INVALID_VOID_REASON');
    const initial = await this.prisma.riderInvoice.findFirst({ where: { clientId, id: invoiceId } });
    if (!initial) throw new NotFoundException('INVOICE_NOT_FOUND');
    const wallet = await this.wallet.ensure(clientId, initial.riderId, actorId);
    return this.wallet.locked(wallet.id, async tx => {
      await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${invoiceId} AND "clientId" = ${clientId} FOR UPDATE`;
      const invoice = await tx.riderInvoice.findFirst({ where: { clientId, id: invoiceId }, include: { lines: true } });
      if (!invoice) throw new NotFoundException('INVOICE_NOT_FOUND');
      if (invoice.status === 'VOID') return invoice;
      if (!['ONBOARDING', 'SECURITY_DEPOSIT'].includes(invoice.invoiceType) || invoice.paidAmount.gt(0) || invoice.outstandingAmount.lt(invoice.totalAmount)) throw new ConflictException('INVOICE_NOT_VOIDABLE');
      if (invoice.invoiceType === 'ONBOARDING') {
        await tx.riderCharge.updateMany({ where: { clientId, invoiceId, status: 'INVOICED' }, data: { status: 'VOIDED' } });
        await tx.riderLedgerEntry.create({ data: { clientId, riderId: invoice.riderId, agreementId: invoice.agreementId, entryType: 'REVERSAL', sourceType: 'RIDER_INVOICE', sourceId: invoiceId, description: `Void onboarding invoice: ${reason}`, creditAmount: invoice.totalAmount, currency: invoice.currency } });
      } else {
        for (const line of invoice.lines) {
          const deposit = await tx.walletSecurityDeposit.findFirst({ where: { clientId, id: line.sourceId } });
          if (!deposit) throw new ConflictException('SECURITY_DEPOSIT_NOT_FOUND');
          const summary = await this.deposits.summaryTx(tx, deposit);
          if (new D(summary.fundedAmount).gt(0) || new D(summary.heldAmount).gt(0)) throw new ConflictException('INVOICE_NOT_VOIDABLE');
          await tx.walletSecurityDeposit.update({ where: { id: deposit.id }, data: { status: 'CANCELLED', updatedById: actorId } });
        }
      }
      const updated = await tx.riderInvoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'WALLET_INVOICE_VOIDED', entityType: 'RiderInvoice', entityId: invoiceId, newData: { reason } } });
      return updated;
    });
  }
  async reverse(clientId: string, transactionId: string, actorId: string, key: string) {
    const original = await this.prisma.walletTransaction.findFirst({ where: { clientId, id: transactionId }, include: { entries: true, invoiceAllocations: true } });
    if (!original || original.transactionType === 'REVERSAL' || !original.invoiceAllocations.some(a => a.kind === 'APPLY')) throw new NotFoundException('WALLET_INVOICE_SETTLEMENT_NOT_FOUND');
    return this.wallet.locked(original.walletId, async tx => {
      const invoiceId = original.invoiceAllocations[0].invoiceId;
      await tx.$queryRaw`SELECT id FROM "RiderInvoice" WHERE id = ${invoiceId} AND "clientId" = ${clientId} FOR UPDATE`;
      const invoice = await tx.riderInvoice.findFirst({ where: { clientId, id: invoiceId } });
      if (!invoice) throw new NotFoundException('INVOICE_NOT_FOUND');
      const existing = await tx.walletTransaction.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey: key } } });
      if (existing) { if (existing.parentTransactionId !== transactionId) throw new ConflictException('IDEMPOTENCY_CONFLICT'); return invoice; }
      if (original.status !== 'POSTED') throw new ConflictException('TRANSACTION_NOT_REVERSIBLE');
      if (invoice.invoiceType === 'SECURITY_DEPOSIT') {
        const deposit = await tx.walletSecurityDeposit.findFirst({ where: { clientId, walletId: original.walletId, id: original.referenceId ?? undefined } });
        if (!deposit || !['PAID', 'PARTIALLY_PAID'].includes(deposit.status)) throw new ConflictException('SECURITY_DEPOSIT_NOT_REVERSIBLE');
      }
      const transaction = await this.wallet.postInTransaction(tx, { clientId, walletId: original.walletId, actorId, type: 'REVERSAL', amount: original.amount.toFixed(2), currency: original.currency, description: `Reverse invoice settlement ${original.transactionNumber}`, idempotencyKey: key, parentTransactionId: original.id, entries: original.entries.map(e => ({ accountId: e.accountId, entryType: e.entryType === 'DEBIT' ? 'CREDIT' : 'DEBIT', amount: e.amount.toFixed(2) })) });
      const amount = original.invoiceAllocations.reduce((sum, a) => sum.plus(a.amount), zero);
      for (const allocation of original.invoiceAllocations) await tx.walletInvoiceAllocation.create({ data: { clientId, invoiceId, transactionId: transaction.id, kind: 'REVERSAL', sourceType: allocation.sourceType, amount: allocation.amount, currency: allocation.currency, reversalOfId: allocation.id, createdById: actorId } });
      if (invoice.invoiceType === 'SECURITY_DEPOSIT') {
        const deposit = await tx.walletSecurityDeposit.findFirst({ where: { clientId, walletId: original.walletId, id: original.referenceId ?? undefined } });
        if (!deposit) throw new ConflictException('SECURITY_DEPOSIT_NOT_FOUND');
        const summary = await this.deposits.summaryTx(tx, deposit);
        const funded = new D(summary.fundedAmount);
        await tx.walletSecurityDeposit.update({ where: { id: deposit.id }, data: { status: funded.eq(0) ? 'PENDING' : funded.gte(deposit.requiredAmount) ? 'PAID' : 'PARTIALLY_PAID', updatedById: actorId } });
      }
      const outstanding = invoice.outstandingAmount.plus(amount);
      const profile = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId: invoice.riderId } } });
      const overdueAt = plusDays(invoice.dueDate, (profile?.gracePeriodDays ?? 0) + 1);
      const status = new Date() >= overdueAt ? 'OVERDUE' : invoice.paidAmount.minus(amount).eq(0) ? 'FINALIZED' : 'PARTIALLY_PAID';
      await tx.riderInvoice.update({ where: { id: invoice.id }, data: { paidAmount: invoice.paidAmount.minus(amount), outstandingAmount: outstanding, status, paidAt: null } });
      await tx.auditLog.create({ data: { clientId, actorId, action: 'WALLET_INVOICE_SETTLEMENT_REVERSED', entityType: 'RiderInvoice', entityId: invoice.id, newData: { amount: amount.toFixed(2) } } });
      return tx.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    });
  }
}
