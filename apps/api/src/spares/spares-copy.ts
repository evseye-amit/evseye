import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type ReturnPenaltyPrice,
  type SparePartMaster,
} from '@prisma/client';
export const snapshotJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const referenceSnapshot = (row: SparePartMaster) => ({
  name: row.name,
  baseRate: row.baseRate.toFixed(2),
  gstPercent: row.gstPercent.toFixed(2),
  hsnCode: row.hsnCode,
  unit: row.unit,
  vehicleTypeIds: row.vehicleTypeIds,
});
export async function recordSpareRevision(
  tx: Prisma.TransactionClient,
  row: ReturnPenaltyPrice | SparePartMaster,
  actorId: string,
  reason: string,
) {
  const client = 'clientId' in row;
  await tx.spareCatalogueRevision.create({
    data: {
      ...(client ? { priceId: row.id } : { masterSpareId: row.id }),
      version: client ? row.configurationVersion : row.version,
      snapshot: snapshotJson(row),
      actorId,
      reason,
    },
  });
}
// Call inside the client creation/import transaction. The caller locks an existing client.
export async function copyActiveSpareMasters(
  tx: Prisma.TransactionClient,
  clientId: string,
  actorId: string,
) {
  const masters = await tx.sparePartMaster.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  const existing = await tx.returnPenaltyPrice.findMany({
    where: { clientId },
    select: { code: true, masterSpareId: true },
  });
  const linked = new Set(existing.map((r) => r.masterSpareId));
  const codes = new Set(existing.map((r) => r.code));
  const conflicts: { masterId: string; code: string }[] = [];
  const data: Prisma.ReturnPenaltyPriceCreateManyInput[] = [];
  for (const master of masters) {
    if (linked.has(master.id)) continue;
    if (codes.has(master.code)) {
      conflicts.push({ masterId: master.id, code: master.code });
      continue;
    }
    data.push({
      id: randomUUID(),
      clientId,
      code: master.code,
      ...referenceSnapshot(master),
      description: master.name,
      category: 'DAMAGE',
      amount: 0,
      currency: 'INR',
      isActive: false,
      isSpare: true,
      penaltyConfigured: false,
      evidenceRequired: true,
      masterSpareId: master.id,
      sourceVersion: master.version,
      createdById: actorId,
    });
    codes.add(master.code);
    linked.add(master.id);
  }
  if (data.length) {
    await tx.returnPenaltyPrice.createMany({ data });
    const copies = await tx.returnPenaltyPrice.findMany({
      where: { clientId, id: { in: data.map((r) => r.id!) } },
    });
    await tx.spareCatalogueRevision.createMany({
      data: copies.map((row) => ({
        priceId: row.id,
        version: row.configurationVersion,
        snapshot: snapshotJson(row),
        actorId,
        reason: 'Imported from active spare master.',
      })),
    });
  }
  const imported = data.length;
  return { imported, conflicts };
}
