import rateCardSeed from './rate-card.staging.json' with { type: 'json' };

const toDate = (value) => (value ? new Date(value) : null);

async function seedRentalRate(prisma, clientId, versionId, actorId, rate) {
  const identity = {
    clientId,
    rateCardVersionId: versionId,
    rentalPeriodType: rate.rentalPeriodType,
    durationValue: rate.durationValue,
    durationUnit: rate.durationUnit,
    vehicleCategoryId: rate.vehicleCategoryId,
    vehicleTypeId: rate.vehicleTypeId,
    oemId: rate.oemId,
    modelName: rate.modelName,
    variantName: rate.variantName,
    fleetId: rate.fleetId,
    priority: rate.priority,
  };
  const existing = await prisma.rateCardRentalRate.findFirst({ where: identity });
  const data = { ...rate, createdById: actorId, updatedById: actorId };
  if (existing) {
    await prisma.rateCardRentalRate.update({ where: { id: existing.id }, data });
  } else {
    await prisma.rateCardRentalRate.create({ data: { ...identity, ...data } });
  }
}

export async function seedYogmayaRateCard(prisma) {
  if (process.env.NODE_ENV === 'production') return;

  const client = await prisma.client.findUnique({ where: { slug: 'yogmaya' } });
  if (!client) throw new Error('Yogmaya must be seeded before its rate card.');

  const actor = await prisma.user.findFirst({
    where: { clientId: client.id, role: 'CLIENT_ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const { versions, ...cardFields } = rateCardSeed;
  const existingCard = await prisma.riderRateCard.findUnique({
    where: { clientId_code: { clientId: client.id, code: rateCardSeed.code } },
    select: { createdById: true },
  });
  const card = await prisma.riderRateCard.upsert({
    where: { clientId_code: { clientId: client.id, code: rateCardSeed.code } },
    create: {
      clientId: client.id,
      ...cardFields,
      createdById: actor?.id,
      updatedById: actor?.id,
    },
    update: {
      ...cardFields,
      createdById: existingCard?.createdById ?? actor?.id,
      updatedById: actor?.id,
    },
  });

  for (const versionSeed of versions) {
    const { rentalRates, fees, deposits, adjustments, ...versionFields } = versionSeed;
    const version = await prisma.riderRateCardVersion.upsert({
      where: {
        clientId_rateCardId_version: {
          clientId: client.id,
          rateCardId: card.id,
          version: versionSeed.version,
        },
      },
      create: {
        clientId: client.id,
        rateCardId: card.id,
        ...versionFields,
        effectiveFrom: toDate(versionFields.effectiveFrom),
        effectiveTo: toDate(versionFields.effectiveTo),
        approvedAt: toDate(versionFields.approvedAt),
        createdById: actor?.id,
        updatedById: actor?.id,
        approvedById: versionFields.approvedAt ? actor?.id : null,
      },
      update: {
        ...versionFields,
        effectiveFrom: toDate(versionFields.effectiveFrom),
        effectiveTo: toDate(versionFields.effectiveTo),
        approvedAt: toDate(versionFields.approvedAt),
        updatedById: actor?.id,
        approvedById: versionFields.approvedAt ? actor?.id : null,
      },
    });

    for (const rate of rentalRates) {
      await seedRentalRate(prisma, client.id, version.id, actor?.id, rate);
    }

    for (const fee of fees) {
      const { code, ...data } = fee;
      await prisma.rateCardFee.upsert({
        where: {
          clientId_rateCardVersionId_code: {
            clientId: client.id,
            rateCardVersionId: version.id,
            code,
          },
        },
        create: {
          clientId: client.id,
          rateCardVersionId: version.id,
          code,
          ...data,
          createdById: actor?.id,
          updatedById: actor?.id,
        },
        update: { ...data, updatedById: actor?.id },
      });
    }

    for (const deposit of deposits) {
      const { code, ...data } = deposit;
      await prisma.rateCardDeposit.upsert({
        where: {
          clientId_rateCardVersionId_code: {
            clientId: client.id,
            rateCardVersionId: version.id,
            code,
          },
        },
        create: {
          clientId: client.id,
          rateCardVersionId: version.id,
          code,
          ...data,
          createdById: actor?.id,
          updatedById: actor?.id,
        },
        update: { ...data, updatedById: actor?.id },
      });
    }

    for (const adjustment of adjustments) {
      const { code, ...data } = adjustment;
      await prisma.rateCardAdjustment.upsert({
        where: {
          clientId_rateCardVersionId_code: {
            clientId: client.id,
            rateCardVersionId: version.id,
            code,
          },
        },
        create: {
          clientId: client.id,
          rateCardVersionId: version.id,
          code,
          ...data,
          createdById: actor?.id,
          updatedById: actor?.id,
        },
        update: { ...data, updatedById: actor?.id },
      });
    }
  }
}
