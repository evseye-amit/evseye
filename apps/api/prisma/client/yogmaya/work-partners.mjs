import { workPartnerCatalog } from '../../catalog/work-partners.mjs';

// Yogmaya receives independent copies of the source catalogue, not live master references.
export const yogmayaWorkPartnerCatalog = workPartnerCatalog.map((entry) => ({ ...entry }));

export async function seedYogmayaWorkPartners(prisma) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUnique({ where: { slug: 'yogmaya' } });
    if (!client) throw new Error('Work partner seed requires the yogmaya client.');
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${client.id} FOR UPDATE`;
    let created = 0;
    for (const entry of yogmayaWorkPartnerCatalog) {
      const master = await tx.workPartnerMaster.findUnique({ where: { code: entry.code } });
      if (!master) throw new Error(`Seed work partner masters first: ${entry.code}`);
      const existing = await tx.clientWorkPartner.findUnique({ where: {
        clientId_code: { clientId: client.id, code: entry.code },
      } });
      if (existing) continue; // Preserve client-owned values and activation settings.
      await tx.clientWorkPartner.create({ data: {
        ...entry, clientId: client.id, sourceMasterId: master.id,
      } });
      created++;
    }
    return { created };
  });
}
