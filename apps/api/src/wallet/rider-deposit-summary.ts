import { Prisma } from '@prisma/client';

/** Agreement deposits are separate from spendable ledger funds. Never post balance credits here. */
export async function riderDepositSummary(tx: Prisma.TransactionClient, clientId: string, riderId: string, currency?: string) {
  const deposits = await tx.riderDeposit.findMany({ where: { clientId, riderId, ...(currency ? { currency } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { transactions: { where: { clientId, riderId }, select: { id: true, transactionType: true, amount: true, reversalOfTransactionId: true } },
      refundRequests: { where: { clientId, status: 'REQUESTED' }, select: { amount: true } } } });
  return deposits.map(deposit => {
    const reversed = new Set(deposit.transactions.flatMap(t => t.reversalOfTransactionId ? [t.reversalOfTransactionId] : []));
    const total = (...types: string[]) => deposit.transactions.filter(t => !reversed.has(t.id) && types.includes(t.transactionType))
      .reduce((sum, t) => sum.plus(t.amount), new Prisma.Decimal(0)).toFixed(2);
    return { id: deposit.id, agreementId: deposit.agreementId, depositType: deposit.depositType, code: deposit.code, currency: deposit.currency,
      status: deposit.status, requiredAmount: deposit.requiredAmount.toFixed(2), paidAmount: total('COLLECTION'),
      refundedAmount: total('REFUND'), deductedAmount: total('DEDUCTION'), forfeitedAmount: total('FORFEITURE'),
      transferredInAmount: total('TRANSFER_IN'), transferredOutAmount: total('TRANSFER_OUT'),
      remainingAmount: deposit.availableAmount.toFixed(2),
      outstandingAmount: ['REQUIRED', 'PARTIALLY_COLLECTED'].includes(deposit.status) ? Prisma.Decimal.max(0, deposit.requiredAmount.minus(deposit.fundedAmount)).toFixed(2) : '0.00',
      pendingRefundAmount: deposit.refundRequests.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0)).toFixed(2),
    };
  });
}
