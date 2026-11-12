import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clientSeed } from './client/pinkrides/client.mjs';
import { hubCatalog } from './client/pinkrides/hubs.mjs';
import { controllers, fleets, fleetComponentMappings } from './client/pinkrides/fleets.mjs';
import { riderTerms } from './client/pinkrides/rider-terms.mjs';
import { seedPinkridesManagers, seedPinkridesWorkPartners, seedPinkridesSpares, seedPinkridesReferral, seedPinkridesRateCard, seedPinkridesLegal } from './client/pinkrides/related.mjs';

const logoPath = fileURLToPath(new URL('./client/pinkrides/assets/logo.png', import.meta.url));
const contentHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function storageClient() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1', requestChecksumCalculation: 'WHEN_REQUIRED', ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
}

export async function seedPinkrides(prisma) {
  const seed = clientSeed;
  const client = await prisma.client.upsert({ where: { slug: seed.client.slug }, create: seed.client, update: seed.client });
  await prisma.clientBusinessProfile.upsert({ where: { clientId: client.id }, create: { clientId: client.id, ...seed.businessProfile }, update: seed.businessProfile });
  for (const contact of seed.contacts) {
    await prisma.clientContact.upsert({ where: { clientId_role: { clientId: client.id, role: contact.role } }, create: { clientId: client.id, ...contact }, update: contact });
  }
  for (const address of seed.addresses) {
    await prisma.clientAddress.upsert({ where: { clientId_type: { clientId: client.id, type: address.type } }, create: { clientId: client.id, ...address }, update: address });
  }
  if (seed.operationsProfile) {
    const { vehicleCategoryCodes, ...operationsData } = seed.operationsProfile;
    const operationsProfile = await prisma.clientOperationsProfile.upsert({
      where: { clientId: client.id },
      create: { clientId: client.id, ...operationsData },
      update: operationsData,
    });
    for (const vehicleCategoryCode of vehicleCategoryCodes) {
      const vehicleCategory = await prisma.vehicleCategory.findUniqueOrThrow({ where: { code: vehicleCategoryCode } });
      await prisma.clientOperationsVehicleCategory.upsert({
        where: {
          operationsProfileId_vehicleCategoryId: {
            operationsProfileId: operationsProfile.id,
            vehicleCategoryId: vehicleCategory.id,
          },
        },
        create: {
          clientId: client.id,
          operationsProfileId: operationsProfile.id,
          vehicleCategoryId: vehicleCategory.id,
        },
        update: {},
      });
    }
  }
  if (seed.billingProfile) {
    await prisma.clientBillingProfile.upsert({
      where: { clientId: client.id },
      create: { clientId: client.id, ...seed.billingProfile },
      update: seed.billingProfile,
    });
  }
  if (seed.agreement) {
    const agreementData = {
      ...seed.agreement,
      termsAcceptedAt: new Date(seed.agreement.termsAcceptedAt),
      privacyAcceptedAt: new Date(seed.agreement.privacyAcceptedAt),
      dataProcessingConsentAt: new Date(seed.agreement.dataProcessingConsentAt),
      kycConsentAt: seed.agreement.kycConsentAt ? new Date(seed.agreement.kycConsentAt) : null,
      marketingConsentAt: seed.agreement.marketingConsentAt ? new Date(seed.agreement.marketingConsentAt) : null,
      submittedAt: seed.agreement.submittedAt ? new Date(seed.agreement.submittedAt) : null,
      approvedAt: seed.agreement.approvedAt ? new Date(seed.agreement.approvedAt) : null,
      rejectedAt: seed.agreement.rejectedAt ? new Date(seed.agreement.rejectedAt) : null,
    };
    await prisma.clientAgreement.upsert({
      where: { clientId: client.id },
      create: { clientId: client.id, ...agreementData },
      update: agreementData,
    });
  }
  const pkg = await prisma.package.findUniqueOrThrow({ where: { code: seed.subscription.packageCode }, select: { id: true } });
  const packageRevision = await prisma.packageRevision.findFirst({
    where: { packageId: pkg.id, publishedAt: { not: null } },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  const startDate = new Date(seed.subscription.startDate);
  const { packageCode: _packageCode, startDate: _startDate, endDate, ...subscriptionData } = seed.subscription;
  const existing = await prisma.clientSubscription.findFirst({
    where: {
      clientId: client.id,
      OR: [
        { packageId: pkg.id, startDate },
        { status: { in: ['PENDING', 'ACTIVE'] }, endDate: null },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  const data = { packageId: pkg.id, ...subscriptionData, endDate: endDate ? new Date(endDate) : null, ...(packageRevision ? { packageRevisionId: packageRevision.id } : {}) };
  const subscription = existing
    ? await prisma.clientSubscription.update({ where: { id: existing.id }, data })
    : await prisma.clientSubscription.create({ data: { clientId: client.id, packageId: pkg.id, startDate, ...data } });

  // Reproduce the client configuration snapshot, not just the subscription shell.
  // Pink Rides is seeded from the published PREMIUM package: every package feature
  // gets a client entitlement and immutable v1 feature/workflow/pricing snapshots.
  const packageFeatures = await prisma.packageFeature.findMany({
    where: { packageId: pkg.id },
    include: { feature: { select: { id: true, code: true, configuration: true } } },
    orderBy: { displayOrder: 'asc' },
  });
  for (const item of packageFeatures) {
    await prisma.clientFeature.upsert({
      where: { subscriptionId_featureId: { subscriptionId: subscription.id, featureId: item.featureId } },
      create: {
        clientId: client.id, subscriptionId: subscription.id, featureId: item.featureId,
        source: 'PACKAGE', enabled: item.isIncluded, includedQuantity: item.includedQuantity ?? 0,
        usageLimit: item.includedQuantity, unlimitedUsage: item.isUnlimited,
        effectiveFrom: startDate, effectiveTo: item.effectiveTo, configuration: item.feature.configuration,
      },
      update: {
        source: 'PACKAGE', enabled: item.isIncluded, includedQuantity: item.includedQuantity ?? 0,
        usageLimit: item.includedQuantity, unlimitedUsage: item.isUnlimited,
        effectiveFrom: startDate, effectiveTo: item.effectiveTo, configuration: item.feature.configuration,
      },
    });
  }
  await prisma.clientFeatureRevision.deleteMany({ where: { subscriptionId: subscription.id, version: { not: 1 } } });
  const featureSnapshot = packageFeatures.map((item) => ({ featureId: item.featureId, source: 'PACKAGE', enabled: item.isIncluded, configuration: item.feature.configuration }));
  await prisma.clientFeatureRevision.upsert({
    where: { subscriptionId_version: { subscriptionId: subscription.id, version: 1 } },
    create: { subscriptionId: subscription.id, version: 1, snapshot: featureSnapshot, contentHash: contentHash(featureSnapshot), publishedAt: new Date() },
    update: { snapshot: featureSnapshot, contentHash: contentHash(featureSnapshot), publishedAt: new Date() },
  });
  const workflowSnapshot = { subscriptionId: subscription.id, overrides: [] };
  await prisma.clientWorkflowRevision.upsert({
    where: { subscriptionId_version: { subscriptionId: subscription.id, version: 1 } },
    create: { subscriptionId: subscription.id, version: 1, snapshot: workflowSnapshot, contentHash: contentHash(workflowSnapshot), publishedAt: new Date() },
    update: { snapshot: workflowSnapshot, contentHash: contentHash(workflowSnapshot), publishedAt: new Date() },
  });
  const pricingSnapshot = { setupFee: subscription.setupFee, pricePerVehicle: subscription.pricePerVehicle, recurringAmount: subscription.recurringAmount, currency: subscription.currency };
  await prisma.clientPricingRevision.upsert({
    where: { subscriptionId_version: { subscriptionId: subscription.id, version: 1 } },
    create: { subscriptionId: subscription.id, version: 1, setupDiscountPercent: 0, vehicleDiscountPercent: 0, setupDiscountType: 'PERCENTAGE', setupDiscountValue: 0, vehicleDiscountType: 'PERCENTAGE', vehicleDiscountValue: 0, snapshot: pricingSnapshot, publishedAt: new Date() },
    update: { setupDiscountPercent: 0, vehicleDiscountPercent: 0, setupDiscountType: 'PERCENTAGE', setupDiscountValue: 0, vehicleDiscountType: 'PERCENTAGE', vehicleDiscountValue: 0, snapshot: pricingSnapshot, publishedAt: new Date() },
  });
  await prisma.clientPaymentProvider.upsert({
    where: { clientId_provider_environment: { clientId: client.id, provider: 'RAZORPAY', environment: 'TEST' } },
    create: { clientId: client.id, provider: 'RAZORPAY', environment: 'TEST', keyId: 'rzp_test_PINKRIDES', secretReference: 'env:PINKRIDES_RAZORPAY_SECRETS', status: 'ACTIVE' },
    update: { keyId: 'rzp_test_PINKRIDES', secretReference: 'env:PINKRIDES_RAZORPAY_SECRETS', status: 'ACTIVE', merchantAccountId: null },
  });

  for (const hubSeed of hubCatalog) {
    await prisma.hub.upsert({ where: { clientId_code: { clientId: client.id, code: hubSeed.code } }, create: { clientId: client.id, ...hubSeed }, update: hubSeed });
  }
  const hub = await prisma.hub.findUniqueOrThrow({ where: { clientId_code: { clientId: client.id, code: 'HUB-TEL-01' } } });
  for (const controllerSeed of controllers) {
    await prisma.controller.upsert({ where: { clientId_controllerNumber: { clientId: client.id, controllerNumber: controllerSeed.controllerNumber } }, create: { clientId: client.id, ...controllerSeed }, update: controllerSeed });
  }
  const [oem, category, vehicleType] = await Promise.all([
    prisma.oem.findUniqueOrThrow({ where: { code: 'ESPRINTO' } }),
    prisma.vehicleCategory.findUniqueOrThrow({ where: { code: '2W' } }),
    prisma.vehicleType.findUniqueOrThrow({ where: { code: 'SCOOTER_ELECTRIC' } }),
  ]);
  for (const fleetSeed of fleets) {
    // Fleet catalog identifiers are resolved to relations above. Keep the
    // static seed readable with its source codes, but do not pass those
    // legacy code fields to Prisma (they are not columns on Fleet).
    const {
      oemCode: _oemCode,
      vehicleCategoryCode: _vehicleCategoryCode,
      vehicleTypeCode: _vehicleTypeCode,
      homeHubCode: _homeHubCode,
      currentHubCode: _currentHubCode,
      ...fleetData
    } = fleetSeed;
    const fleet = await prisma.fleet.upsert({
      where: { clientId_fleetCode: { clientId: client.id, fleetCode: fleetSeed.fleetCode } },
      create: { ...fleetData, clientId: client.id, oemId: oem.id, vehicleCategoryId: category.id, vehicleTypeId: vehicleType.id, homeHubId: hub.id, currentHubId: hub.id },
      update: { ...fleetData, oemId: oem.id, vehicleCategoryId: category.id, vehicleTypeId: vehicleType.id, homeHubId: hub.id, currentHubId: hub.id },
    });
    const mapping = fleetComponentMappings.find((item) => item.fleetCode === fleet.fleetCode);
    const controller = await prisma.controller.findUniqueOrThrow({ where: { clientId_controllerNumber: { clientId: client.id, controllerNumber: mapping.controllerNumber } } });
    const installedAt = new Date('2026-10-01T00:00:00.000Z');
    const history = await prisma.fleetControllerHistory.findFirst({ where: { fleetId: fleet.id, controllerId: controller.id, installedAt } });
    if (!history) await prisma.fleetControllerHistory.create({ data: { fleetId: fleet.id, controllerId: controller.id, installedAt } });
  }
  const existingTerms = await prisma.riderCommercialTerms.findUnique({ where: { clientId_code_version: { clientId: client.id, code: riderTerms.code, version: riderTerms.version } } });
  if (existingTerms) await prisma.riderCommercialTerms.update({ where: { id: existingTerms.id }, data: riderTerms });
  else await prisma.riderCommercialTerms.create({ data: { clientId: client.id, ...riderTerms } });

  // Baseline rider rental plan for Pink Rides. Keep this idempotent so re-running
  // the application seed never creates duplicate cards or rates.
  const rateCard = await prisma.riderRateCard.upsert({
    where: { clientId_code: { clientId: client.id, code: 'PINKRIDES-STANDARD-2026' } },
    create: { clientId: client.id, code: 'PINKRIDES-STANDARD-2026', name: 'Pink Rides Standard Monthly', currency: 'INR', isDefault: true, status: 'DRAFT' },
    update: { name: 'Pink Rides Standard Monthly', currency: 'INR', isDefault: true },
  });
  let rateVersion = await prisma.riderRateCardVersion.findFirst({ where: { clientId: client.id, rateCardId: rateCard.id, version: 1 } });
  if (!rateVersion) rateVersion = await prisma.riderRateCardVersion.create({ data: { clientId: client.id, rateCardId: rateCard.id, version: 1, effectiveFrom: new Date('2026-11-12T00:00:00.000Z'), currency: 'INR', description: 'Initial Pink Rides rider rental pricing' } });
  await prisma.rateCardRentalRate.upsert({
    where: { id: (await prisma.rateCardRentalRate.findFirst({ where: { clientId: client.id, rateCardVersionId: rateVersion.id, rentalPeriodType: 'MONTHLY' }, select: { id: true } }))?.id ?? '00000000-0000-0000-0000-000000000000' },
    create: { clientId: client.id, rateCardVersionId: rateVersion.id, rentalPeriodType: 'MONTHLY', amount: '5000.00', includedKm: '1500.00', extraKmRate: '4.00', taxable: true, taxRate: '18.00', priceIncludesTax: false },
    update: { amount: '5000.00', includedKm: '1500.00', extraKmRate: '4.00', taxable: true, taxRate: '18.00', priceIncludesTax: false, isActive: true },
  });
  const existingDeposit = await prisma.rateCardDeposit.findFirst({ where: { clientId: client.id, rateCardVersionId: rateVersion.id, code: 'VEHICLE-SECURITY' } });
  if (existingDeposit) await prisma.rateCardDeposit.update({ where: { id: existingDeposit.id }, data: { amount: '0.00', waiverAmount: '0.00', isActive: true } });
  else await prisma.rateCardDeposit.create({ data: { clientId: client.id, rateCardVersionId: rateVersion.id, code: 'VEHICLE-SECURITY', name: 'Vehicle security deposit', depositType: 'VEHICLE_SECURITY', amount: '0.00', waiverAmount: '0.00' } });
  const existingFee = await prisma.rateCardFee.findFirst({ where: { clientId: client.id, rateCardVersionId: rateVersion.id, code: 'ONBOARDING_FEE' } });
  if (existingFee) await prisma.rateCardFee.update({ where: { id: existingFee.id }, data: { amount: '0.00', isActive: true } });
  else await prisma.rateCardFee.create({ data: { clientId: client.id, rateCardVersionId: rateVersion.id, code: 'ONBOARDING_FEE', name: 'Onboarding fee', chargeType: 'ONBOARDING_FEE', nature: 'ONE_TIME', eligibility: 'ONCE_PER_CLIENT_RIDER_RELATIONSHIP', amount: '0.00', taxable: false, priceIncludesTax: false } });

  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    const objectKey = `clients/${client.id}/logo/seed.png`;
    const storage = storageClient();
    try { await storage.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: await readFile(logoPath), ContentType: 'image/png', CacheControl: 'public, max-age=86400' })); }
    finally { storage.destroy(); }
    await prisma.clientBusinessProfile.update({ where: { clientId: client.id }, data: { logoObjectKey: objectKey } });
    await prisma.clientBranding.upsert({ where: { clientId: client.id }, create: { clientId: client.id, logoObjectKey: objectKey }, update: { logoObjectKey: objectKey } });
  } else console.warn('Skipping Pink Rides logo because S3_BUCKET is not configured.');
  await seedPinkridesManagers(prisma);
  await seedPinkridesWorkPartners(prisma);
  await seedPinkridesSpares(prisma);
  await seedPinkridesReferral(prisma);
  await seedPinkridesRateCard(prisma);
  await seedPinkridesLegal(prisma);
  console.info(`Seeded Pink Rides client, hub, ${fleets.length} fleets/controllers, rider terms, and branding.`);
  return { client, subscription };
}
