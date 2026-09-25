import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RiderCreditStatus, RiderInvoiceStatus, RiderLedgerEntryType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { allocateCredits, chargeAmount, positiveDecimal, ZERO } from './billing-money.js';
import type { CreateRiderChargeDto, CreateRiderCreditDto, FinalizeRiderInvoiceDto } from './dto/billing.dto.js';

type Tx = Prisma.TransactionClient;
const isolationLevel = Prisma.TransactionIsolationLevel.Serializable;
const amountString = (value: Prisma.Decimal) => value.toFixed(2);
const dateOnly = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid calendar date.');
  return date;
};

@Injectable()
export class RiderBillingService {
  constructor(private readonly prisma: PrismaService) {}

  private async serializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(fn, { isolationLevel, timeout: 10000 }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
        throw error;
      }
    }
  }

  private async rider(tx: Tx, clientId: string, riderId: string) {
    const rider = await tx.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider not found in this client.');
    return rider;
  }

  private async profile(tx: Tx, clientId: string, riderId: string, currency: string) {
    const existing = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId } } });
    if (existing && existing.currency !== currency) throw new BadRequestException('Currency differs from the Rider payment profile.');
    if (!existing) await tx.riderPaymentProfile.create({ data: { clientId, riderId, currency } });
  }

  private async log(tx: Tx, clientId: string, riderId: string, actorId: string | null, action: string, entityType: string, entityId: string, details: Record<string, string>) {
    await tx.auditLog.create({ data: { clientId, actorId, action, entityType, entityId, newData: details } });
  }

  async postCharge(clientId: string, riderId: string, actorId: string, sourceKey: string, dto: CreateRiderChargeDto) {
    const quantity = positiveDecimal(dto.quantity, 4, 'Quantity');
    const unitAmount = positiveDecimal(dto.unitAmount, 2, 'Unit amount');
    const amount = chargeAmount(quantity, unitAmount);
    const currency = dto.currency ?? 'INR';
    const effectiveAt = dto.effectiveDate ? dateOnly(dto.effectiveDate) : new Date();
    try {
      return await this.serializable(async tx => {
        await this.rider(tx, clientId, riderId);
        const previous = await tx.riderCharge.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
        if (previous) {
          if (previous.riderId !== riderId || previous.chargeType !== dto.chargeType || previous.description !== dto.description || !previous.quantity.eq(quantity) || !previous.unitAmount.eq(unitAmount) || previous.currency !== currency || previous.referenceType !== (dto.referenceType ?? null) || previous.referenceId !== (dto.referenceId ?? null) || (dto.effectiveDate && previous.effectiveAt.toISOString().slice(0, 10) !== dto.effectiveDate)) throw new ConflictException('Idempotency key was used for a different charge.');
          return previous;
        }
        await this.profile(tx, clientId, riderId, currency);
        const charge = await tx.riderCharge.create({ data: { clientId, riderId, sourceKey, chargeType: dto.chargeType, description: dto.description, referenceType: dto.referenceType, referenceId: dto.referenceId, quantity, unitAmount, amount, currency, effectiveAt } });
        await tx.riderLedgerEntry.create({ data: { clientId, riderId, entryType: RiderLedgerEntryType.CHARGE, sourceType: 'RIDER_CHARGE', sourceId: charge.id, description: charge.description, debitAmount: amount, currency, effectiveAt } });
        await this.log(tx, clientId, riderId, actorId, 'RIDER_CHARGE_POSTED', 'RiderCharge', charge.id, { amount: amountString(amount), currency, sourceKey });
        return charge;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await this.prisma.riderCharge.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
        if (previous && previous.riderId === riderId && previous.chargeType === dto.chargeType && previous.description === dto.description && previous.quantity.eq(quantity) && previous.unitAmount.eq(unitAmount) && previous.currency === currency && previous.referenceType === (dto.referenceType ?? null) && previous.referenceId === (dto.referenceId ?? null) && (!dto.effectiveDate || previous.effectiveAt.toISOString().slice(0, 10) === dto.effectiveDate)) return previous;
        throw new ConflictException('Idempotency key or charge source is already in use.');
      }
      throw error;
    }
  }

  async issueCreditInTransaction(tx: Tx, input: { clientId: string; riderId: string; actorId: string | null; sourceKey: string; creditType: string; description: string; amount: Prisma.Decimal; currency: string; referenceType?: string; referenceId?: string; effectiveAt?: Date }) {
    const { clientId, riderId, actorId, sourceKey, amount, currency } = input;
    if (amount.lte(0) || amount.decimalPlaces() > 2) throw new BadRequestException('Credit amount must be positive with at most two decimal places.');
    await this.rider(tx, clientId, riderId);
    const previous = await tx.riderCredit.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
    if (previous) {
      if (previous.riderId !== riderId || previous.creditType !== input.creditType || previous.description !== input.description || !previous.amount.eq(amount) || previous.currency !== currency || previous.referenceType !== (input.referenceType ?? null) || previous.referenceId !== (input.referenceId ?? null) || (input.effectiveAt && previous.effectiveAt.toISOString().slice(0, 10) !== input.effectiveAt.toISOString().slice(0, 10))) throw new ConflictException('Idempotency key was used for a different credit.');
      return previous;
    }
    await this.profile(tx, clientId, riderId, currency);
    const credit = await tx.riderCredit.create({ data: { clientId, riderId, sourceKey, creditType: input.creditType, description: input.description, referenceType: input.referenceType, referenceId: input.referenceId, amount, remainingAmount: amount, currency, effectiveAt: input.effectiveAt ?? new Date() } });
    await tx.riderLedgerEntry.create({ data: { clientId, riderId, entryType: RiderLedgerEntryType.CREDIT, sourceType: 'RIDER_CREDIT', sourceId: credit.id, description: credit.description, creditAmount: amount, currency, effectiveAt: credit.effectiveAt } });
    await this.log(tx, clientId, riderId, actorId, 'RIDER_CREDIT_ISSUED', 'RiderCredit', credit.id, { amount: amountString(amount), currency, sourceKey });
    return credit;
  }

  async postCredit(clientId: string, riderId: string, actorId: string, sourceKey: string, dto: CreateRiderCreditDto) {
    const amount = positiveDecimal(dto.amount, 2, 'Credit amount');
    const currency = dto.currency ?? 'INR';
    try {
      return await this.serializable(tx => this.issueCreditInTransaction(tx, { clientId, riderId, actorId, sourceKey, creditType: dto.creditType, description: dto.description, amount, currency, referenceType: dto.referenceType, referenceId: dto.referenceId, effectiveAt: dto.effectiveDate ? dateOnly(dto.effectiveDate) : undefined }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await this.prisma.riderCredit.findUnique({ where: { clientId_sourceKey: { clientId, sourceKey } } });
        if (previous && previous.riderId === riderId && previous.creditType === dto.creditType && previous.description === dto.description && previous.amount.eq(amount) && previous.currency === currency && previous.referenceType === (dto.referenceType ?? null) && previous.referenceId === (dto.referenceId ?? null) && (!dto.effectiveDate || previous.effectiveAt.toISOString().slice(0, 10) === dto.effectiveDate)) return previous;
        throw new ConflictException('Idempotency key or credit source is already in use.');
      }
      throw error;
    }
  }

  async finalizeInvoice(clientId: string, riderId: string, actorId: string, dto: FinalizeRiderInvoiceDto) {
    const start = dateOnly(dto.billingPeriodStart);
    const end = dateOnly(dto.billingPeriodEnd);
    const dueDate = dateOnly(dto.dueDate);
    if (end <= start || dueDate < end) throw new BadRequestException('Billing period or due date is invalid.');
    const cutoff = new Date(end.getTime() + 86400000);
    try {
      return await this.serializable(async tx => {
        await this.rider(tx, clientId, riderId);
        const period = { clientId, riderId, billingPeriodStart: start, billingPeriodEnd: end };
        const existing = await tx.riderInvoice.findUnique({ where: { clientId_riderId_billingPeriodStart_billingPeriodEnd: period }, include: { lines: true } });
        if (existing) return existing;
        const profile = await tx.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId } } });
        const currency = profile?.currency ?? 'INR';
        const charges = await tx.riderCharge.findMany({ where: { clientId, riderId, status: 'OPEN', effectiveAt: { lt: cutoff } }, orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }] });
        const credits = await tx.riderCredit.findMany({ where: { clientId, riderId, status: { in: [RiderCreditStatus.AVAILABLE, RiderCreditStatus.PARTIALLY_APPLIED] }, effectiveAt: { lt: cutoff }, remainingAmount: { gt: ZERO } }, orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }] });
        if (charges.some(item => item.currency !== currency) || credits.some(item => item.currency !== currency)) throw new ConflictException('Mixed currencies cannot be invoiced.');
        const { subtotal, creditAmount, totalAmount, allocations } = allocateCredits(charges.map(item => item.amount), credits.map(item => item.remainingAmount));
        const invoice = await tx.riderInvoice.create({ data: { clientId, riderId, invoiceNumber: `RB-${randomUUID()}`, billingPeriodStart: start, billingPeriodEnd: end, subtotal, creditAmount, totalAmount, outstandingAmount: totalAmount, currency, dueDate, status: RiderInvoiceStatus.DRAFT } });
        for (const charge of charges) {
          await tx.riderInvoiceLine.create({ data: { clientId, invoiceId: invoice.id, kind: 'CHARGE', sourceId: charge.id, description: charge.description, amount: charge.amount, currency } });
          await tx.riderCharge.update({ where: { id: charge.id }, data: { invoiceId: invoice.id, status: 'INVOICED' } });
        }
        for (let index = 0; index < credits.length; index++) {
          const used = allocations[index];
          if (!used || used.lte(0)) continue;
          const credit = credits[index];
          const remainingAmount = credit.remainingAmount.minus(used);
          await tx.riderInvoiceLine.create({ data: { clientId, invoiceId: invoice.id, kind: 'CREDIT', sourceId: credit.id, description: credit.description, amount: used, currency } });
          await tx.riderCredit.update({ where: { id: credit.id }, data: { remainingAmount, status: remainingAmount.eq(0) ? RiderCreditStatus.APPLIED : RiderCreditStatus.PARTIALLY_APPLIED } });
        }
        await tx.riderInvoice.update({ where: { id: invoice.id }, data: { status: totalAmount.eq(0) ? RiderInvoiceStatus.PAID : RiderInvoiceStatus.FINALIZED, finalizedAt: new Date(), paidAt: totalAmount.eq(0) ? new Date() : null } });
        await this.log(tx, clientId, riderId, actorId, 'RIDER_INVOICE_FINALIZED', 'RiderInvoice', invoice.id, { subtotal: amountString(subtotal), creditAmount: amountString(creditAmount), totalAmount: amountString(totalAmount), currency });
        return tx.riderInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const previous = await this.prisma.riderInvoice.findUnique({ where: { clientId_riderId_billingPeriodStart_billingPeriodEnd: { clientId, riderId, billingPeriodStart: start, billingPeriodEnd: end } }, include: { lines: true } });
        if (previous) return previous;
        throw new ConflictException('Invoice number or line source already exists.');
      }
      throw error;
    }
  }

  async riderForUser(clientId: string, userId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider profile not found.');
    return rider.id;
  }

  private async requireRider(clientId: string, riderId: string) {
    const rider = await this.prisma.rider.findFirst({ where: { id: riderId, clientId, deletedAt: null }, select: { id: true } });
    if (!rider) throw new NotFoundException('Rider not found in this client.');
  }

  async overview(clientId: string, riderId: string) {
    await this.requireRider(clientId, riderId);
    const [profile, openCharges, credits, invoices] = await Promise.all([
      this.prisma.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId } } }),
      this.prisma.riderCharge.aggregate({ where: { clientId, riderId, status: 'OPEN' }, _sum: { amount: true } }),
      this.prisma.riderCredit.aggregate({ where: { clientId, riderId, status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } }, _sum: { remainingAmount: true } }),
      this.prisma.riderInvoice.aggregate({ where: { clientId, riderId, status: { in: ['FINALIZED', 'PARTIALLY_PAID', 'OVERDUE'] } }, _sum: { outstandingAmount: true } }),
    ]);
    return { profile, currency: profile?.currency ?? 'INR', openChargeAmount: amountString(openCharges._sum.amount ?? ZERO), availableCreditAmount: amountString(credits._sum.remainingAmount ?? ZERO), outstandingInvoiceAmount: amountString(invoices._sum.outstandingAmount ?? ZERO) };
  }

  async invoices(clientId: string, riderId: string) { await this.requireRider(clientId, riderId); return this.prisma.riderInvoice.findMany({ where: { clientId, riderId }, orderBy: { createdAt: 'desc' } }); }
  async invoice(clientId: string, riderId: string, invoiceId: string) {
    const invoice = await this.prisma.riderInvoice.findFirst({ where: { id: invoiceId, clientId, riderId }, include: { lines: { orderBy: { createdAt: 'asc' } } } });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }
  async ledger(clientId: string, riderId: string) { await this.requireRider(clientId, riderId); return this.prisma.riderLedgerEntry.findMany({ where: { clientId, riderId }, orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }], take: 100 }); }
}
