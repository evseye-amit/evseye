import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clientSeed } from './client/pinkrides/client.mjs';
import { hubCatalog } from './client/pinkrides/hubs.mjs';
import { controllers, fleets, fleetComponentMappings } from './client/pinkrides/fleets.mjs';
import { riderTerms } from './client/pinkrides/rider-terms.mjs';

const logoPath = fileURLToPath(new URL('./client/pinkrides/assets/logo.png', import.meta.url));

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
  const pkg = await prisma.package.findUniqueOrThrow({ where: { code: seed.subscription.packageCode }, select: { id: true } });
  const startDate = new Date(seed.subscription.startDate);
  const { packageCode: _packageCode, startDate: _startDate, endDate, ...subscriptionData } = seed.subscription;
  const existing = await prisma.clientSubscription.findFirst({ where: { clientId: client.id, packageId: pkg.id, startDate } });
  const data = { ...subscriptionData, endDate: endDate ? new Date(endDate) : null };
  const subscription = existing
    ? await prisma.clientSubscription.update({ where: { id: existing.id }, data })
    : await prisma.clientSubscription.create({ data: { clientId: client.id, packageId: pkg.id, startDate, ...data } });

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
    const fleet = await prisma.fleet.upsert({
      where: { clientId_fleetCode: { clientId: client.id, fleetCode: fleetSeed.fleetCode } },
      create: { ...fleetSeed, clientId: client.id, oemId: oem.id, vehicleCategoryId: category.id, vehicleTypeId: vehicleType.id, homeHubId: hub.id, currentHubId: hub.id },
      update: { ...fleetSeed, oemId: oem.id, vehicleCategoryId: category.id, vehicleTypeId: vehicleType.id, homeHubId: hub.id, currentHubId: hub.id },
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

  const bucket = process.env.S3_BUCKET;
  if (bucket) {
    const objectKey = `clients/${client.id}/logo/seed.png`;
    const storage = storageClient();
    try { await storage.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: await readFile(logoPath), ContentType: 'image/png', CacheControl: 'public, max-age=86400' })); }
    finally { storage.destroy(); }
    await prisma.clientBusinessProfile.update({ where: { clientId: client.id }, data: { logoObjectKey: objectKey } });
    await prisma.clientBranding.upsert({ where: { clientId: client.id }, create: { clientId: client.id, logoObjectKey: objectKey }, update: { logoObjectKey: objectKey } });
  } else console.warn('Skipping Pink Rides logo because S3_BUCKET is not configured.');
  console.info(`Seeded Pink Rides client, hub, ${fleets.length} fleets/controllers, rider terms, and branding.`);
  return { client, subscription };
}
