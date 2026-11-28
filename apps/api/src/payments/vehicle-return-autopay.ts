import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function disableAutoPayAfterVehicleReturn(
  tx: Tx,
  clientId: string,
  riderId: string,
  actorId: string,
  allocationId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Rider" WHERE id=${riderId} AND "clientId"=${clientId} FOR UPDATE`;

  const otherAllocation = await tx.allocation.findFirst({
    where: {
      clientId,
      riderId,
      status: 'ACTIVE',
      allocatedAt: { not: null },
      id: { not: allocationId },
    },
    select: { id: true },
  });
  if (otherAllocation)
    return { disabled: false, reason: 'ACTIVE_ALLOCATION' as const };

  const preference = await tx.walletAutoRechargePreference.findUnique({
    where: { clientId_riderId: { clientId, riderId } },
  });
  if (!preference?.enabled)
    return { disabled: false, reason: 'ALREADY_DISABLED' as const };

  await tx.walletAutoRechargePreference.update({
    where: { id: preference.id },
    data: {
      enabled: false,
      actionRequired: false,
      revision: { increment: 1 },
    },
  });
  await tx.paymentMandate.updateMany({
    where: {
      id: preference.mandateId,
      clientId,
      riderId,
    },
    data: { autoDebitEnabled: false },
  });
  await tx.riderPaymentProfile.updateMany({
    where: { clientId, riderId },
    data: { autoPayEnabled: false },
  });
  const cancelled = await tx.walletAutoRecharge.updateMany({
    where: {
      walletId: preference.walletId,
      status: { in: ['CREATING', 'UNKNOWN'] },
      orderClaimedAt: null,
      debitClaimedAt: null,
      providerOrderId: null,
      providerPaymentId: null,
    },
    data: {
      status: 'CANCELLED',
      failureCode: 'VEHICLE_RETURNED',
    },
  });
  await tx.auditLog.create({
    data: {
      clientId,
      actorId,
      action: 'WALLET_AUTOPAY_DISABLED',
      entityType: 'RiderWallet',
      entityId: preference.walletId,
      newData: {
        enabled: false,
        reason: 'VEHICLE_RETURN',
        allocationId,
        cancelledRechargeCount: cancelled.count,
      },
    },
  });
  return { disabled: true, cancelledRechargeCount: cancelled.count };
}
