// Development-only commercial example. No prices in runtime logic.
export async function seedRiderRateCardDemo(prisma) {
  if (
    process.env.SEED_RATE_CARD_DEMO !== '1' ||
    process.env.NODE_ENV === 'production'
  )
    return;
  const client = await prisma.client.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!client) return;
  const actor = await prisma.user.findFirst({
    where: { clientId: client.id, role: 'CLIENT_ADMIN' },
  });
  const card = await prisma.riderRateCard.upsert({
    where: {
      clientId_code: { clientId: client.id, code: 'GURUGRAM_2W_STANDARD' },
    },
    create: {
      clientId: client.id,
      code: 'GURUGRAM_2W_STANDARD',
      name: 'Gurugram 2W Standard',
      status: 'DRAFT',
      createdById: actor?.id,
      updatedById: actor?.id,
    },
    update: {},
  });
  const version = await prisma.riderRateCardVersion.upsert({
    where: {
      clientId_rateCardId_version: {
        clientId: client.id,
        rateCardId: card.id,
        version: 1,
      },
    },
    create: {
      clientId: client.id,
      rateCardId: card.id,
      version: 1,
      effectiveFrom: new Date('2026-10-01'),
      status: 'DRAFT',
      createdById: actor?.id,
      updatedById: actor?.id,
    },
    update: {},
  });
  if (version.status !== 'DRAFT') return;
  if (
    !(await prisma.rateCardRentalRate.count({
      where: { rateCardVersionId: version.id },
    }))
  ) {
    await prisma.rateCardRentalRate.createMany({
      data: [
        ['DAILY', '250'],
        ['WEEKLY', '1500'],
        ['MONTHLY', '5800'],
      ].map(([rentalPeriodType, amount]) => ({
        clientId: client.id,
        rateCardVersionId: version.id,
        rentalPeriodType,
        amount,
        createdById: actor?.id,
        updatedById: actor?.id,
      })),
    });
  }
  const adjustments = [
    ['AGE_0_6', 'VEHICLE_AGE', '100', 0, 6, null],
    ['AGE_7_12', 'VEHICLE_AGE', '0', 7, 12, null],
    ['AGE_13_24', 'VEHICLE_AGE', '-100', 13, 24, null],
    ['AGE_25_PLUS', 'VEHICLE_AGE', '-250', 25, null, null],
    ['CYBER_CITY', 'LOCATION', '100', null, null, 'Cyber City'],
    ['SOHNA', 'LOCATION', '-100', null, null, 'Sohna'],
  ];
  for (const [
    code,
    adjustmentType,
    amount,
    minVehicleAgeMonths,
    maxVehicleAgeMonths,
    zone,
  ] of adjustments) {
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
        adjustmentType,
        calculationType: 'FIXED_AMOUNT',
        amount,
        minVehicleAgeMonths,
        maxVehicleAgeMonths,
        zone,
        createdById: actor?.id,
        updatedById: actor?.id,
      },
      update: {},
    });
  }
  for (const [code, name, depositType, amount] of [
    ['RIDER_SECURITY', 'Rider Security', 'RIDER_SECURITY', '2000'],
    ['VEHICLE_SECURITY', 'Vehicle Security', 'VEHICLE_SECURITY', '1500'],
  ]) {
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
        name,
        depositType,
        amount,
        createdById: actor?.id,
        updatedById: actor?.id,
      },
      update: {},
    });
  }
  await prisma.rateCardFee.upsert({
    where: {
      clientId_rateCardVersionId_code: {
        clientId: client.id,
        rateCardVersionId: version.id,
        code: 'ONBOARDING_FEE',
      },
    },
    create: {
      clientId: client.id,
      rateCardVersionId: version.id,
      code: 'ONBOARDING_FEE',
      name: 'Onboarding Fee',
      chargeType: 'ONBOARDING_FEE',
      nature: 'ONE_TIME',
      amount: '299',
      createdById: actor?.id,
      updatedById: actor?.id,
    },
    update: {},
  });
  await prisma.riderBatteryPlan.upsert({
    where: { clientId_code: { clientId: client.id, code: 'INCLUDED' } },
    create: {
      clientId: client.id,
      code: 'INCLUDED',
      name: 'Battery Included',
      pricingType: 'INCLUDED',
      amount: '0',
      createdById: actor?.id,
      updatedById: actor?.id,
    },
    update: {},
  });
}
