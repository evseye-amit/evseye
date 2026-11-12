import { findSeedActor } from '../../seed-actor.mjs';
import { workPartnerCatalog } from '../../catalog/work-partners.mjs';
import { yogmayaSpareCatalog } from '../yogmaya/spares.mjs';
import referralSeed from '../yogmaya/referral-campaign.staging.json' with { type: 'json' };
import rateCardSeed from '../yogmaya/rate-card.staging.json' with { type: 'json' };
import { legalDocumentCatalog as baseLegalDocuments } from '../yogmaya/yogmaya-legal-documents.mjs';
import { clientManagerCatalog as baseManagers } from '../yogmaya/client-managers.mjs';
import { createHash } from 'node:crypto';
import { pinkridesStagingLegalDocuments } from './staging-legal-documents.mjs';

// These are deliberately static snapshots. Pink Rides owns independent rows and
// can change them later without mutating the master catalog or Yogmaya data.
export const pinkridesManagerCatalog = baseManagers.map((entry, index) => ({
  ...entry,
  clientSlug: 'pinkrides',
  mobile: index === 0 ? '9948423040' : '9948423041',
  name: index === 0 ? 'Pink Rides Fleet Manager' : 'Pink Rides Team Lead',
  role: index === 0 ? 'FLEET_MANAGER' : 'TEAM_LEAD',
  hubAssignments: [{ hubCode: 'HUB-TEL-01', isPrimary: true }],
  teamLeaderProfile: index === 0 ? null : { ...entry.teamLeaderProfile, employeeCode: 'PR-TL-0001' },
}));
export const pinkridesWorkPartnerCatalog = workPartnerCatalog.map((entry) => ({ ...entry }));
export const pinkridesLegalDocumentCatalog = baseLegalDocuments.map((entry) => ({
  ...entry,
  clientCode: 'pinkrides',
  content: entry.content.replaceAll('Yogmaya', 'Pink Rides EV Rental & Spares').replaceAll('yogmaya.com', 'pinkrides.example'),
  title: entry.title.replaceAll('Yogmaya', 'Pink Rides EV Rental & Spares'),
})).map((entry) => ({
  ...entry,
  contentHash: createHash('sha256').update(entry.acceptance
    ? JSON.stringify({ content: entry.content, acceptance: Object.fromEntries(Object.entries(entry.acceptance).sort(([a], [b]) => a.localeCompare(b))) })
    : entry.content, 'utf8').digest('hex'),
}));

async function client(prisma) {
  const row = await prisma.client.findUnique({ where: { slug: 'pinkrides' } });
  if (!row) throw new Error('Pink Rides must be seeded before related data.');
  return row;
}

export async function seedPinkridesManagers(prisma) {
  const c = await client(prisma);
  for (const seed of pinkridesManagerCatalog) {
    const { clientSlug: _clientSlug, hubAssignments, teamLeaderProfile, ...userData } = seed;
    const user = await prisma.user.upsert({ where: { clientId_mobile: { clientId: c.id, mobile: userData.mobile } }, create: { clientId: c.id, ...userData }, update: userData });
    if (teamLeaderProfile) await prisma.teamLeaderProfile.upsert({ where: { userId: user.id }, create: { clientId: c.id, userId: user.id, ...teamLeaderProfile, joiningDate: new Date(teamLeaderProfile.joiningDate) }, update: { ...teamLeaderProfile, joiningDate: new Date(teamLeaderProfile.joiningDate) } });
    for (const assignment of hubAssignments) {
      const hub = await prisma.hub.findUnique({ where: { clientId_code: { clientId: c.id, code: assignment.hubCode } } });
      if (hub) await prisma.userHub.upsert({ where: { userId_hubId: { userId: user.id, hubId: hub.id } }, create: { clientId: c.id, userId: user.id, hubId: hub.id, isPrimary: assignment.isPrimary }, update: { isPrimary: assignment.isPrimary } });
    }
  }
}

export async function seedPinkridesWorkPartners(prisma) {
  const c = await client(prisma);
  for (const entry of pinkridesWorkPartnerCatalog) {
    const master = await prisma.workPartnerMaster.findUnique({ where: { code: entry.code } });
    if (!master) continue;
    await prisma.clientWorkPartner.upsert({ where: { clientId_code: { clientId: c.id, code: entry.code } }, create: { clientId: c.id, sourceMasterId: master.id, ...entry }, update: { sourceMasterId: master.id, ...entry } });
  }
}

export async function seedPinkridesSpares(prisma) {
  const c = await client(prisma); const actor = await findSeedActor(prisma, c.id);
  if (!actor) throw new Error('Pink Rides spares seed requires a seed actor.');
  for (const entry of yogmayaSpareCatalog) {
    const master = await prisma.sparePartMaster.findUnique({ where: { code: entry.code } });
    if (!master) continue;
    const existing = await prisma.returnPenaltyPrice.findUnique({ where: { clientId_code: { clientId: c.id, code: entry.code } } });
    if (existing?.penaltyConfigured) continue;
    const data = { name: master.name, description: master.name, baseRate: master.baseRate, gstPercent: master.gstPercent, hsnCode: master.hsnCode, unit: master.unit, vehicleTypeIds: master.vehicleTypeIds, sourceVersion: master.version, amount: entry.penaltyAmount, currency: 'INR', category: 'DAMAGE', isActive: true, penaltyConfigured: true, evidenceRequired: entry.evidenceRequired };
    const row = existing ? await prisma.returnPenaltyPrice.update({ where: { id: existing.id }, data: { ...data, configurationVersion: { increment: 1 }, updatedById: actor.id } }) : await prisma.returnPenaltyPrice.create({ data: { clientId: c.id, code: entry.code, isSpare: true, masterSpareId: master.id, createdById: actor.id, ...data } });
    await prisma.spareCatalogueRevision.create({ data: { priceId: row.id, version: row.configurationVersion, snapshot: JSON.parse(JSON.stringify(row)), actorId: actor.id, reason: 'Initial Pink Rides penalty seed.' } });
  }
}

export async function seedPinkridesReferral(prisma) {
  const c = await client(prisma); const actor = await findSeedActor(prisma, c.id); if (!actor) throw new Error('Pink Rides referral seed requires a seed actor.');
  const { milestones, ...fields } = referralSeed;
  const campaign = await prisma.referralCampaign.upsert({ where: { clientId_code: { clientId: c.id, code: referralSeed.code } }, create: { clientId: c.id, ...fields, startAt: new Date(fields.startAt), endAt: new Date(fields.endAt), activatedAt: fields.activatedAt ? new Date(fields.activatedAt) : null, createdById: actor.id, updatedById: actor.id }, update: { ...fields, startAt: new Date(fields.startAt), endAt: new Date(fields.endAt), activatedAt: fields.activatedAt ? new Date(fields.activatedAt) : null, updatedById: actor.id } });
  for (const { milestoneType, ...data } of milestones) await prisma.referralCampaignMilestone.upsert({ where: { campaignId_milestoneType: { campaignId: campaign.id, milestoneType } }, create: { campaignId: campaign.id, milestoneType, ...data }, update: data });
}

export async function seedPinkridesRateCard(prisma) {
  const c = await client(prisma); const actor = await findSeedActor(prisma, c.id);
  const { versions, ...fields } = rateCardSeed;
  const card = await prisma.riderRateCard.upsert({ where: { clientId_code: { clientId: c.id, code: 'PINKRIDES-STANDARD-2026' } }, create: { clientId: c.id, ...fields, code: 'PINKRIDES-STANDARD-2026', createdById: actor?.id, updatedById: actor?.id }, update: { ...fields, code: 'PINKRIDES-STANDARD-2026', updatedById: actor?.id } });
  for (const seed of versions) { const { rentalRates, fees, deposits, adjustments, ...vf } = seed; const v = await prisma.riderRateCardVersion.upsert({ where: { clientId_rateCardId_version: { clientId: c.id, rateCardId: card.id, version: seed.version } }, create: { clientId: c.id, rateCardId: card.id, ...vf, effectiveFrom: new Date(vf.effectiveFrom), effectiveTo: vf.effectiveTo ? new Date(vf.effectiveTo) : null, approvedAt: vf.approvedAt ? new Date(vf.approvedAt) : null, createdById: actor?.id, updatedById: actor?.id }, update: { ...vf, effectiveFrom: new Date(vf.effectiveFrom), effectiveTo: vf.effectiveTo ? new Date(vf.effectiveTo) : null, approvedAt: vf.approvedAt ? new Date(vf.approvedAt) : null, updatedById: actor?.id } });
    for (const rate of rentalRates) { const existing = await prisma.rateCardRentalRate.findFirst({ where: { clientId: c.id, rateCardVersionId: v.id, rentalPeriodType: rate.rentalPeriodType, priority: rate.priority } }); if (existing) await prisma.rateCardRentalRate.update({ where: { id: existing.id }, data: rate }); else await prisma.rateCardRentalRate.create({ data: { clientId: c.id, rateCardVersionId: v.id, ...rate } }); }
    for (const [items, model] of [[fees, prisma.rateCardFee], [deposits, prisma.rateCardDeposit], [adjustments, prisma.rateCardAdjustment]]) for (const item of items) { const { code, ...data } = item; await model.upsert({ where: { clientId_rateCardVersionId_code: { clientId: c.id, rateCardVersionId: v.id, code } }, create: { clientId: c.id, rateCardVersionId: v.id, code, ...data }, update: data }); }
  }
}

export async function seedPinkridesLegal(prisma) {
  const catalog = pinkridesStagingLegalDocuments.length ? pinkridesStagingLegalDocuments : pinkridesLegalDocumentCatalog;
  for (const doc of catalog) { const { clientCode: _clientCode, ...fields } = doc; const c = await client(prisma); const identity = { clientId: c.id, appCode: fields.appCode, role: fields.role, kind: fields.kind, locale: fields.locale, version: fields.version }; const existing = await prisma.appLegalDocument.findFirst({ where: identity }); if (existing?.publishedAt) continue; if (existing) await prisma.appLegalDocument.update({ where: { id: existing.id }, data: { ...fields, effectiveAt: new Date(fields.effectiveAt), publishedAt: fields.publishedAt ? new Date(fields.publishedAt) : null, retiredAt: fields.retiredAt ? new Date(fields.retiredAt) : null } }); else await prisma.appLegalDocument.create({ data: { ...identity, ...fields, effectiveAt: new Date(fields.effectiveAt), publishedAt: fields.publishedAt ? new Date(fields.publishedAt) : null, retiredAt: fields.retiredAt ? new Date(fields.retiredAt) : null } }); }
}
