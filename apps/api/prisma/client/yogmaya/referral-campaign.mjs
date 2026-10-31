import campaignSeed from './referral-campaign.staging.json' with { type: 'json' };

const dateFields = ['startAt', 'endAt', 'activatedAt'];

export async function seedYogmayaReferralCampaign(prisma) {
  // These records are a snapshot of the staging workspace, not production
  // configuration. The consolidated seed remains safe to run in production.
  if (process.env.NODE_ENV === 'production') return;

  const client = await prisma.client.findUnique({ where: { slug: 'yogmaya' } });
  if (!client) throw new Error('Yogmaya must be seeded before its referral campaign.');

  const actor = await prisma.user.findFirst({
    where: { clientId: client.id, role: 'CLIENT_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!actor) throw new Error('Yogmaya Client Admin must be seeded before its referral campaign.');

  const { milestones, ...campaignFields } = campaignSeed;
  const campaignData = Object.fromEntries(
    Object.entries(campaignFields).map(([key, value]) => [
      key,
      dateFields.includes(key) && value ? new Date(value) : value,
    ]),
  );

  const existing = await prisma.referralCampaign.findUnique({
    where: { clientId_code: { clientId: client.id, code: campaignSeed.code } },
    select: { createdById: true },
  });
  const campaign = await prisma.referralCampaign.upsert({
    where: { clientId_code: { clientId: client.id, code: campaignSeed.code } },
    create: {
      clientId: client.id,
      ...campaignData,
      createdById: actor.id,
      updatedById: actor.id,
    },
    update: {
      ...campaignData,
      createdById: existing?.createdById ?? actor.id,
      updatedById: actor.id,
    },
  });

  for (const milestoneSeed of milestones) {
    const { milestoneType, ...data } = milestoneSeed;
    await prisma.referralCampaignMilestone.upsert({
      where: {
        campaignId_milestoneType: { campaignId: campaign.id, milestoneType },
      },
      create: { campaignId: campaign.id, milestoneType, ...data },
      update: data,
    });
  }
}
