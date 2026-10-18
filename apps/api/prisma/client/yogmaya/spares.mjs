// Source: EVSI SINGLE LIGHT - BODY PARTS PRICING - Copy.xlsx, PLASTIC PARTS, rows 2–33.
// finalAmount is column G (GST-inclusive). Penalty = finalAmount + INR 20, once per piece.
// Evidence stays required. Images are intentionally excluded.
export const yogmayaSpareCatalog = [
  {
    "code": "EVSI-SL-001",
    "finalAmount": "35.40",
    "penaltyAmount": "55.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-002",
    "finalAmount": "35.40",
    "penaltyAmount": "55.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-003",
    "finalAmount": "35.40",
    "penaltyAmount": "55.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-004",
    "finalAmount": "42.48",
    "penaltyAmount": "62.48",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-005",
    "finalAmount": "42.48",
    "penaltyAmount": "62.48",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-006",
    "finalAmount": "42.48",
    "penaltyAmount": "62.48",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-007",
    "finalAmount": "106.20",
    "penaltyAmount": "126.20",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-008",
    "finalAmount": "106.20",
    "penaltyAmount": "126.20",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-009",
    "finalAmount": "92.04",
    "penaltyAmount": "112.04",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-010",
    "finalAmount": "198.24",
    "penaltyAmount": "218.24",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-011",
    "finalAmount": "191.16",
    "penaltyAmount": "211.16",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-012",
    "finalAmount": "495.60",
    "penaltyAmount": "515.60",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-013",
    "finalAmount": "169.92",
    "penaltyAmount": "189.92",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-014",
    "finalAmount": "169.92",
    "penaltyAmount": "189.92",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-015",
    "finalAmount": "424.80",
    "penaltyAmount": "444.80",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-016",
    "finalAmount": "198.24",
    "penaltyAmount": "218.24",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-017",
    "finalAmount": "127.44",
    "penaltyAmount": "147.44",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-018",
    "finalAmount": "63.72",
    "penaltyAmount": "83.72",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-019",
    "finalAmount": "35.40",
    "penaltyAmount": "55.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-020",
    "finalAmount": "21.24",
    "penaltyAmount": "41.24",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-021",
    "finalAmount": "424.80",
    "penaltyAmount": "444.80",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-022",
    "finalAmount": "283.20",
    "penaltyAmount": "303.20",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-023",
    "finalAmount": "212.40",
    "penaltyAmount": "232.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-024",
    "finalAmount": "70.80",
    "penaltyAmount": "90.80",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-025",
    "finalAmount": "84.96",
    "penaltyAmount": "104.96",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-026",
    "finalAmount": "290.28",
    "penaltyAmount": "310.28",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-027",
    "finalAmount": "290.28",
    "penaltyAmount": "310.28",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-028",
    "finalAmount": "212.40",
    "penaltyAmount": "232.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-029",
    "finalAmount": "212.40",
    "penaltyAmount": "232.40",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-030",
    "finalAmount": "283.20",
    "penaltyAmount": "303.20",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-031",
    "finalAmount": "708.00",
    "penaltyAmount": "728.00",
    "evidenceRequired": true
  },
  {
    "code": "EVSI-SL-032",
    "finalAmount": "318.60",
    "penaltyAmount": "338.60",
    "evidenceRequired": true
  }
];

export async function seedYogmayaSpares(prisma) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { slug: 'yogmaya' } });
    if (!client) throw new Error('Yogmaya spares seed requires the yogmaya client.');
    // Use the same client lock as catalogue edits/imports.
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${client.id} FOR UPDATE`;
    const actor = await tx.user.findFirst({
      where: { clientId: client.id, role: 'CLIENT_ADMIN', isActive: true, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    if (!actor) throw new Error('Yogmaya spares seed requires an active Client Admin.');
    let created = 0;
    let configured = 0;
    for (const entry of yogmayaSpareCatalog) {
      const master = await tx.sparePartMaster.findUnique({ where: { code: entry.code } });
      if (!master) throw new Error(`Seed master spares before Yogmaya: ${entry.code}`);
      const existing = await tx.returnPenaltyPrice.findUnique({
        where: { clientId_code: { clientId: client.id, code: entry.code } },
      });
      if (existing && (!existing.isSpare || existing.masterSpareId !== master.id)) {
        throw new Error(`Yogmaya spare code conflicts with an unrelated entry: ${entry.code}`);
      }
      // Preserve all settings once configured by an admin or a previous seed run.
      if (existing?.penaltyConfigured) continue;
      const data = {
        name: master.name, description: master.name, baseRate: master.baseRate,
        gstPercent: master.gstPercent, hsnCode: master.hsnCode, unit: master.unit,
        vehicleTypeIds: master.vehicleTypeIds, sourceVersion: master.version,
        amount: entry.penaltyAmount, currency: 'INR', category: 'DAMAGE',
        isActive: true, penaltyConfigured: true, evidenceRequired: entry.evidenceRequired,
      };
      const row = existing
        ? await tx.returnPenaltyPrice.update({ where: { id: existing.id }, data: {
            ...data, configurationVersion: { increment: 1 }, updatedById: actor.id,
          } })
        : await tx.returnPenaltyPrice.create({ data: {
            ...data, clientId: client.id, code: entry.code, isSpare: true,
            masterSpareId: master.id, createdById: actor.id,
          } });
      await tx.spareCatalogueRevision.create({ data: {
        priceId: row.id, version: row.configurationVersion,
        snapshot: JSON.parse(JSON.stringify(row)), actorId: actor.id,
        reason: 'Initial Yogmaya penalty: spreadsheet final amount plus INR 20 per piece.',
      } });
      if (existing) configured++; else created++;
    }
    return { created, configured };
  });
}
