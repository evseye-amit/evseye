import { deploymentBreakdowns } from './deployment-breakdown.js';
import { Prisma, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

export type HistoryQuery = {
  clientId: string; riderId: string; walletId?: string; currency?: string;
  page: number; pageSize: number; type?: WalletTransactionType; status?: WalletTransactionStatus;
  from?: Date; end?: Date; id?: string; hideLegacyTopUps?: boolean;
};
type HistoryRow = {
  id: string; transactionNumber: string; transactionType: WalletTransactionType;
  status: WalletTransactionStatus; amount: string; currency: string; description: string;
  referenceType: string | null; referenceId: string | null; createdAt: Date; postedAt: Date | null;
  affectsBalance: boolean;
};

/** Read-only history projection. Deployment receipts must never be posted as new balance credits. */
export async function transactionHistory(tx: Prisma.TransactionClient, q: HistoryQuery) {
  const source = Prisma.sql`
    SELECT t.id, t."transactionNumber", t."transactionType"::text, t.status::text,
      t.amount::text, t.currency, t.description, t."referenceType", t."referenceId", t."createdAt", t."postedAt",
      TRUE AS "affectsBalance"
    FROM "WalletTransaction" t JOIN "RiderWallet" w ON w.id=t."walletId" AND w."clientId"=t."clientId"
    WHERE t."clientId"=${q.clientId} AND w."riderId"=${q.riderId}
      ${q.walletId ? Prisma.sql`AND w.id=${q.walletId}` : Prisma.empty}
      ${q.hideLegacyTopUps ? Prisma.sql`AND NOT (t."transactionType"='TOP_UP' AND t.status='POSTED' AND COALESCE(t."referenceType", '')='PAYMENT_COLLECTION' AND NOT EXISTS (SELECT 1 FROM "WalletLedgerEntry" e WHERE e."transactionId"=t.id))` : Prisma.empty}
    UNION ALL
    SELECT 'deployment:' || p.id, 'EVD-' || p.id, 'PAYMENT', 'POSTED', p.amount::text,
      p.currency, 'Deployment payment (paid externally)', 'DEPLOYMENT_PAYMENT', p.id, p."createdAt", p."paidAt", FALSE
    FROM "DeploymentPayment" p
    JOIN "MobileDeploymentWorkflow" d ON d.id=p."workflowId" AND d."clientId"=p."clientId"
    JOIN "Allocation" a ON a.id=d."allocationId" AND a."clientId"=p."clientId"
    WHERE p."clientId"=${q.clientId} AND a."riderId"=${q.riderId} AND p.status='PAID' AND p.amount>0
      ${q.currency ? Prisma.sql`AND p.currency=${q.currency}` : Prisma.empty}
    UNION ALL
    SELECT 'deposit-refund:' || r.id, 'EVDR-' || r.id, 'SECURITY_DEPOSIT_REFUND',
      CASE WHEN EXISTS (SELECT 1 FROM "RiderDepositTransaction" reversal WHERE reversal."clientId"=r."clientId" AND reversal."reversalOfTransactionId"=r.id) THEN 'REVERSED' ELSE 'POSTED' END,
      r.amount::text, r.currency, 'Security deposit refund (paid externally)', 'RIDER_DEPOSIT_REFUND', r.id, r."createdAt", r."createdAt", FALSE
    FROM "RiderDepositTransaction" r JOIN "RiderDeposit" deposit ON deposit.id=r."depositId" AND deposit."clientId"=r."clientId"
    WHERE r."clientId"=${q.clientId} AND r."riderId"=${q.riderId} AND deposit."riderId"=${q.riderId} AND r."transactionType"='REFUND'
      ${q.currency ? Prisma.sql`AND r.currency=${q.currency}` : Prisma.empty}`;
  const base = Prisma.sql`FROM (${source}) h WHERE TRUE
    ${q.type ? Prisma.sql`AND h."transactionType"=${q.type}` : Prisma.empty}
    ${q.status ? Prisma.sql`AND h.status=${q.status}` : Prisma.empty}
    ${q.from ? Prisma.sql`AND h."createdAt">=${q.from}` : Prisma.empty}
    ${q.end ? Prisma.sql`AND h."createdAt"<${q.end}` : Prisma.empty}
    ${q.id ? Prisma.sql`AND h.id=${q.id}` : Prisma.empty}`;
  const [rows, counts] = await Promise.all([
    tx.$queryRaw<HistoryRow[]>(Prisma.sql`SELECT h.* ${base} ORDER BY h."createdAt" DESC, h.id DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total ${base}`),
  ]);
  const breakdowns = await deploymentBreakdowns(tx, q.clientId, q.riderId,
    rows.filter(row => row.referenceType === 'DEPLOYMENT_PAYMENT').map(row => row.referenceId!));
  const refundIds = rows.filter(row => row.referenceType === 'RIDER_DEPOSIT_REFUND').map(row => row.referenceId!);
  const refunds = refundIds.length ? await tx.riderDepositTransaction.findMany({ where: { clientId: q.clientId, riderId: q.riderId, id: { in: refundIds } },
    select: { id: true, depositId: true, deposit: { select: { transactions: { where: { clientId: q.clientId, riderId: q.riderId, transactionType: 'COLLECTION', referenceType: 'DEPLOYMENT_PAYMENT' }, select: { referenceId: true } } } } } }) : [];
  const refundLinks = new Map(refunds.map(refund => [refund.id, { depositId: refund.depositId,
    deploymentPaymentIds: [...new Set(refund.deposit.transactions.flatMap(t => t.referenceId ? [t.referenceId] : []))] }]));
  const ids = rows.filter(row => row.affectsBalance).map(row => row.id);
  const entries = ids.length ? await tx.walletLedgerEntry.findMany({
    where: { clientId: q.clientId, transactionId: { in: ids }, account: { clientId: q.clientId, accountType: { in: ['CASH', 'REWARD', 'SECURITY_DEPOSIT'] } } },
    select: { transactionId: true, amount: true, entryType: true, account: { select: { accountType: true } } },
  }) : [];
  return { items: rows.map(row => {
    const movements = (['POSTED', 'REVERSED'].includes(row.status) ? ['CASH', 'REWARD', 'SECURITY_DEPOSIT'] : []).map(bucket => ({ bucket,
      amount: entries.filter(entry => entry.transactionId === row.id && entry.account.accountType === bucket)
        .reduce((sum, entry) => sum.plus(entry.entryType === 'CREDIT' ? entry.amount : entry.amount.neg()), new Prisma.Decimal(0)).toFixed(2),
    })).filter(entry => entry.amount !== '0.00');
    return { ...row, ...(row.referenceType === 'RIDER_DEPOSIT_REFUND' ? refundLinks.get(row.referenceId!) : {}), ...(row.referenceType === 'DEPLOYMENT_PAYMENT' ? { breakdown: breakdowns.get(row.referenceId!) ?? { status: 'UNAVAILABLE', items: [] } } : {}), amount: new Prisma.Decimal(row.amount).toFixed(2), affectsBalance: movements.length > 0, movements };
  }), meta: { page: q.page, pageSize: q.pageSize, total: Number(counts[0].total) } };
}
