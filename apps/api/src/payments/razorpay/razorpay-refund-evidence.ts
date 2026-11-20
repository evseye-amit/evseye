import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';

export async function unaccountedRefund(db: PrismaService, clientId: string, paymentId: string | null, remote: { amount_refunded: number; status: string }) {
  if (remote.amount_refunded === 0 && remote.status !== 'refunded') return false;
  if (!paymentId || remote.amount_refunded <= 0) return true;
  const total = await db.paymentRefund.aggregate({ where: { clientId, paymentId, provider: 'RAZORPAY', status: 'SUCCESS' }, _sum: { amount: true } });
  return !(total._sum.amount ?? new Prisma.Decimal(0)).mul(100).eq(remote.amount_refunded);
}
