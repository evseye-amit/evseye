import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, UserRole } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { oemCatalog } from './catalog/oems.mjs';
import { clientCatalog } from './catalog/clients.mjs';
import { clientManagerCatalog } from './catalog/client-managers.mjs';
import { hubCatalog } from './catalog/hubs.mjs';
import { fleets } from './catalog/fleets.mjs';
import { iotDevices } from './catalog/iot-devices.mjs';
import { batteries } from './catalog/batteries.mjs';
import { controllers } from './catalog/controllers.mjs';
import { fleetComponentMappings } from './catalog/fleet-component-mappings.mjs';
import { featureCatalog } from './catalog/features.mjs';
import { featureAddOnCatalog } from './catalog/feature-addons.mjs';
import { featurePricingCatalog } from './catalog/feature-pricing.mjs';
import { packageFeatureAddOnCatalog } from './catalog/package-feature-addons.mjs';
import { packageFeatureCatalog } from './catalog/package-features.mjs';
import { featureStepSpecs } from './catalog/feature-steps.mjs';
import { featureStepTranslations } from './catalog/feature-step-translations.mjs';
import { packageCatalog } from './catalog/packages.mjs';
import { packageVehicleTierPricingCatalog } from './catalog/package-vehicle-tier-pricing.mjs';
import { vehicleCategoryCatalog } from './catalog/vehicle-categories.mjs';
import { vehicleTypeCatalog } from './catalog/vehicle-types.mjs';

const prisma = new PrismaClient();

const storage = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  ...(process.env.S3_ENDPOINT
    ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

async function seedOemLogo(id, code) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required to seed OEM logos.');
  let extension = 'png';
  let image;
  try {
    image = await readFile(
      new URL(`./catalog/assets/oem/${code}.png`, import.meta.url),
    );
  } catch {
    extension = 'svg';
    image = await readFile(
      new URL(`./catalog/assets/oem/${code}.svg`, import.meta.url),
    );
  }
  const objectKey = `platform/oems/${id}/logo/seed.${extension}`;
  await storage.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: image,
      ContentType: extension === 'svg' ? 'image/svg+xml' : 'image/png',
    }),
  );
  return objectKey;
}

async function main() {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { clientId: null, mobile: '+919100000000' },
  });
  if (existingSuperAdmin) {
    await prisma.user.update({
      where: { id: existingSuperAdmin.id },
      data: {
        name: 'EVs Eye Super Admin',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        mobile: '+919100000000',
        name: 'EVs Eye Super Admin',
        role: UserRole.SUPER_ADMIN,
      },
    });
  }

  await prisma.oem.upsert({
    where: { code: 'EVSEYE' },
    create: {
      code: 'EVSEYE',
      name: 'EVs Eye Mobility Systems',
      displayName: 'EVs Eye',
      status: 'ACTIVE',
      description: 'Platform sample OEM record.',
    },
    update: {
      name: 'EVs Eye Mobility Systems',
      displayName: 'EVs Eye',
      status: 'ACTIVE',
    },
  });

  await Promise.all(
    oemCatalog.map(async ({ logoSourceUrl: _logoSourceUrl, ...oem }) => {
      const existing = await prisma.oem.findUnique({
        where: { code: oem.code },
        select: { id: true, logoObjectKey: true },
      });
      const id = existing?.id ?? crypto.randomUUID();
      const logoObjectKey = await seedOemLogo(id, oem.code);
      return prisma.oem.upsert({
        where: { code: oem.code },
        create: { id, ...oem, logoObjectKey },
        update: { ...oem, logoObjectKey },
      });
    }),
  );

  const vehicleCategories = await Promise.all(
    vehicleCategoryCatalog.map((vehicleCategory) =>
      prisma.vehicleCategory.upsert({
        where: { code: vehicleCategory.code },
        create: vehicleCategory,
        update: vehicleCategory,
      }),
    ),
  );

  const vehicleCategoryIdsByCode = new Map(
    vehicleCategories.map(({ code, id }) => [code, id]),
  );
  await Promise.all(
    vehicleTypeCatalog.map(({ categoryCode, ...vehicleType }) => {
      const categoryId = vehicleCategoryIdsByCode.get(categoryCode);
      if (!categoryId) {
        throw new Error(
          `Vehicle type seed references missing category code: ${categoryCode}`,
        );
      }

      return prisma.vehicleType.upsert({
        where: { code: vehicleType.code },
        create: { ...vehicleType, categoryId },
        update: { ...vehicleType, categoryId },
      });
    }),
  );

  const featureSteps = new Map();
  for (const step of featureStepSpecs.filter((item) => !item.parentCode)) {
    const { parentCode: _parentCode, ...stepData } = step;
    const translations = featureStepTranslations[step.code];
    const saved = await prisma.featureStep.upsert({
      where: { code: step.code },
      create: { ...stepData, ...(translations ? { translations } : {}) },
      update: { displayName: step.displayName, description: step.description, ...(translations ? { translations } : {}), displayOrder: step.displayOrder, isActive: true },
    });
    featureSteps.set(step.code, saved);
  }
  for (const step of featureStepSpecs.filter((item) => item.parentCode)) {
    const { parentCode, ...stepData } = step;
    const translations = featureStepTranslations[step.code];
    const saved = await prisma.featureStep.upsert({
      where: { code: step.code },
      create: { ...stepData, parentId: featureSteps.get(parentCode).id, ...(translations ? { translations } : {}) },
      update: { displayName: step.displayName, parentId: featureSteps.get(parentCode).id, ...(translations ? { translations } : {}), displayOrder: step.displayOrder, isActive: true },
    });
    featureSteps.set(step.code, saved);
  }
  await Promise.all(
    featureCatalog.map(({ featureStepCode, ...feature }) => {
      const featureStep = featureSteps.get(featureStepCode);
      if (!featureStep) {
        throw new Error(
          `Feature seed references missing Feature Step code: ${featureStepCode}`,
        );
      }
      return prisma.feature.upsert({
        where: { code: feature.code },
        create: { ...feature, featureStepId: featureStep.id },
        update: { ...feature, featureStepId: featureStep.id },
      });
    }),
  );

  // A feature can have several historical prices that share an effective date.
  // The complete commercial identity is used here instead of only feature + date,
  // which preserves inactive superseded prices alongside the current one.
  for (const { featureCode, effectiveFrom, effectiveTo, billingUnit, currency, isActive, ...pricing } of featurePricingCatalog) {
    const feature = await prisma.feature.findUniqueOrThrow({
      where: { code: featureCode },
    });
    const effectiveDate = new Date(effectiveFrom);
    const expiryDate = effectiveTo ? new Date(effectiveTo) : null;
    const existing = await prisma.featurePricing.findFirst({
      where: {
        featureId: feature.id,
        effectiveFrom: effectiveDate,
        effectiveTo: expiryDate,
        billingUnit,
        currency,
        isActive,
      },
    });
    const pricingData = {
      ...pricing,
      billingUnit,
      currency,
      isActive,
      effectiveTo: expiryDate,
    };
    if (existing) {
      await prisma.featurePricing.update({
        where: { id: existing.id },
        data: pricingData,
      });
    } else {
      await prisma.featurePricing.create({
        data: { ...pricingData, featureId: feature.id, effectiveFrom: effectiveDate },
      });
    }
  }

  await Promise.all(
    packageCatalog.map((pkg) =>
      prisma.package.upsert({
        where: { code: pkg.code },
        create: pkg,
        update: pkg,
      }),
    ),
  );

  const packages = await prisma.package.findMany({ where: { code: { in: packageCatalog.map((item) => item.code) } } });
  const packageByCode = new Map(packages.map((pkg) => [pkg.code, pkg]));

  for (const {
    packageCode,
    effectiveFrom,
    effectiveTo,
    ...tierData
  } of packageVehicleTierPricingCatalog) {
    const pkg = packageByCode.get(packageCode);
    if (!pkg) {
      throw new Error(
        `Package Vehicle Tier Pricing seed references a missing Package code: ${packageCode}`,
      );
    }

    const effectiveDate = new Date(effectiveFrom);
    await prisma.packageVehicleTierPricing.upsert({
      where: {
        packageId_minVehicles_effectiveFrom: {
          packageId: pkg.id,
          minVehicles: tierData.minVehicles,
          effectiveFrom: effectiveDate,
        },
      },
      create: {
        packageId: pkg.id,
        ...tierData,
        effectiveFrom: effectiveDate,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
      update: {
        ...tierData,
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      },
    });
  }

  for (const { packageCode, featureCode, configuration, ...packageFeature } of packageFeatureCatalog) {
    const pkg = packageByCode.get(packageCode);
    const feature = await prisma.feature.findUniqueOrThrow({ where: { code: featureCode } });
    if (!pkg) throw new Error(`Package Feature seed references a missing Package code: ${packageCode}`);
    const data = { ...packageFeature, ...(configuration === null ? {} : { configuration }) };
    await prisma.packageFeature.upsert({
      where: { packageId_featureId: { packageId: pkg.id, featureId: feature.id } },
      create: { packageId: pkg.id, featureId: feature.id, ...data },
      update: data,
    });
  }
  for (const { featureCode, effectiveFrom: addOnEffectiveFrom, effectiveTo, ...addOnData } of featureAddOnCatalog) {
    const feature = await prisma.feature.findUniqueOrThrow({ where: { code: featureCode } });
    await prisma.featureAddOn.upsert({
      where: { code: addOnData.code },
      create: { ...addOnData, featureId: feature.id, effectiveFrom: new Date(addOnEffectiveFrom), effectiveTo: effectiveTo ? new Date(effectiveTo) : null },
      update: { ...addOnData, featureId: feature.id, effectiveFrom: new Date(addOnEffectiveFrom), effectiveTo: effectiveTo ? new Date(effectiveTo) : null },
    });
  }

  for (const { packageCode, featureAddOnCode, isAvailable } of packageFeatureAddOnCatalog) {
    const pkg = packageByCode.get(packageCode);
    const featureAddOn = await prisma.featureAddOn.findUnique({
      where: { code: featureAddOnCode },
    });
    if (!pkg || !featureAddOn) {
      throw new Error(
        `Package Add-On seed references a missing ${!pkg ? 'Package' : 'Feature Add-On'}: ${!pkg ? packageCode : featureAddOnCode}`,
      );
    }
    await prisma.packageFeatureAddOn.upsert({
      where: {
        packageId_featureAddOnId: {
          packageId: pkg.id,
          featureAddOnId: featureAddOn.id,
        },
      },
      create: { packageId: pkg.id, featureAddOnId: featureAddOn.id, isAvailable },
      update: { isAvailable },
    });
  }

  for (const clientSeed of clientCatalog) {
    const client = await prisma.client.upsert({
      where: { slug: clientSeed.client.slug },
      create: clientSeed.client,
      update: clientSeed.client,
    });

    if (clientSeed.businessProfile) {
      await prisma.clientBusinessProfile.upsert({
        where: { clientId: client.id },
        create: { clientId: client.id, ...clientSeed.businessProfile },
        update: clientSeed.businessProfile,
      });
    }

    for (const contact of clientSeed.contacts) {
      await prisma.clientContact.upsert({
        where: { clientId_role: { clientId: client.id, role: contact.role } },
        create: { clientId: client.id, ...contact },
        update: contact,
      });
    }

    // A client workspace requires its designated Account Admin to be able to
    // sign in. Keep this user derived from the same source record as the
    // contact rather than maintaining a separate, drifting credential seed.
    const accountAdmin = clientSeed.contacts.find(
      (contact) => contact.role === 'ACCOUNT_ADMIN',
    );
    if (accountAdmin?.mobile) {
      const normalizedMobile = (() => {
        const digits = accountAdmin.mobile.replace(/\D/g, '');
        const local = /^\d{10}$/.test(digits)
          ? digits
          : /^0(\d{10})$/.exec(digits)?.[1] ?? /^91(\d{10})$/.exec(digits)?.[1];
        return local && /^[6-9]\d{9}$/.test(local)
          ? `+91${local}`
          : accountAdmin.mobile.trim();
      })();
      await prisma.user.upsert({
        where: {
          clientId_mobile: {
            clientId: client.id,
            mobile: normalizedMobile,
          },
        },
        create: {
          clientId: client.id,
          name: accountAdmin.name,
          mobile: normalizedMobile,
          role: UserRole.CLIENT_ADMIN,
          isActive: true,
        },
        update: {
          name: accountAdmin.name,
          role: UserRole.CLIENT_ADMIN,
          isActive: true,
          deletedAt: null,
        },
      });
    }

    for (const address of clientSeed.addresses) {
      await prisma.clientAddress.upsert({
        where: { clientId_type: { clientId: client.id, type: address.type } },
        create: { clientId: client.id, ...address },
        update: address,
      });
    }

    if (clientSeed.operationsProfile) {
      const { vehicleCategoryCodes, ...operationsData } = clientSeed.operationsProfile;
      const operationsProfile = await prisma.clientOperationsProfile.upsert({
        where: { clientId: client.id },
        create: { clientId: client.id, ...operationsData },
        update: operationsData,
      });
      for (const vehicleCategoryCode of vehicleCategoryCodes) {
        const vehicleCategory = await prisma.vehicleCategory.findUniqueOrThrow({
          where: { code: vehicleCategoryCode },
        });
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

    if (clientSeed.billingProfile) {
      await prisma.clientBillingProfile.upsert({
        where: { clientId: client.id },
        create: { clientId: client.id, ...clientSeed.billingProfile },
        update: clientSeed.billingProfile,
      });
    }

    if (clientSeed.agreement) {
      const agreementData = {
        ...clientSeed.agreement,
        termsAcceptedAt: new Date(clientSeed.agreement.termsAcceptedAt),
        privacyAcceptedAt: new Date(clientSeed.agreement.privacyAcceptedAt),
        dataProcessingConsentAt: new Date(clientSeed.agreement.dataProcessingConsentAt),
        kycConsentAt: clientSeed.agreement.kycConsentAt ? new Date(clientSeed.agreement.kycConsentAt) : null,
        marketingConsentAt: clientSeed.agreement.marketingConsentAt ? new Date(clientSeed.agreement.marketingConsentAt) : null,
        submittedAt: clientSeed.agreement.submittedAt ? new Date(clientSeed.agreement.submittedAt) : null,
        approvedAt: clientSeed.agreement.approvedAt ? new Date(clientSeed.agreement.approvedAt) : null,
        rejectedAt: clientSeed.agreement.rejectedAt ? new Date(clientSeed.agreement.rejectedAt) : null,
      };
      await prisma.clientAgreement.upsert({
        where: { clientId: client.id },
        create: { clientId: client.id, ...agreementData },
        update: agreementData,
      });
    }

    if (clientSeed.branding) {
      await prisma.clientBranding.upsert({
        where: { clientId: client.id },
        create: { clientId: client.id, ...clientSeed.branding },
        update: clientSeed.branding,
      });
    }

    for (const domain of clientSeed.domains) {
      await prisma.clientDomain.upsert({
        where: { hostname: domain.hostname },
        create: { clientId: client.id, ...domain },
        update: { clientId: client.id, ...domain },
      });
    }

    for (const { packageCode, startDate, endDate, ...subscriptionData } of clientSeed.subscriptions) {
      const pkg = packageByCode.get(packageCode);
      if (!pkg) {
        throw new Error(`Client seed references a missing Package code: ${packageCode}`);
      }
      const subscriptionStartDate = new Date(startDate);
      const existingSubscription = await prisma.clientSubscription.findFirst({
        where: { clientId: client.id, packageId: pkg.id, startDate: subscriptionStartDate },
      });
      const data = {
        ...subscriptionData,
        endDate: endDate ? new Date(endDate) : null,
      };
      if (existingSubscription) {
        await prisma.clientSubscription.update({ where: { id: existingSubscription.id }, data });
      } else {
        await prisma.clientSubscription.create({
          data: {
            clientId: client.id,
            packageId: pkg.id,
            startDate: subscriptionStartDate,
            ...data,
          },
        });
      }
    }
  }

  // Seed base Hub records before their parent-child hierarchy, allowing the
  // catalog to represent arbitrarily deep hub structures.
  for (const hubSeed of hubCatalog) {
    const { clientSlug, parentHubCode: _parentHubCode, deletedAt, ...hubData } = hubSeed;
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: clientSlug } });
    await prisma.hub.upsert({
      where: { clientId_code: { clientId: client.id, code: hubData.code } },
      create: { clientId: client.id, ...hubData, parentHubId: null, deletedAt: deletedAt ? new Date(deletedAt) : null },
      update: { ...hubData, parentHubId: null, deletedAt: deletedAt ? new Date(deletedAt) : null },
    });
  }
  for (const hubSeed of hubCatalog) {
    if (!hubSeed.parentHubCode) continue;
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: hubSeed.clientSlug } });
    const [hub, parentHub] = await Promise.all([
      prisma.hub.findUniqueOrThrow({ where: { clientId_code: { clientId: client.id, code: hubSeed.code } } }),
      prisma.hub.findUniqueOrThrow({ where: { clientId_code: { clientId: client.id, code: hubSeed.parentHubCode } } }),
    ]);
    await prisma.hub.update({ where: { id: hub.id }, data: { parentHubId: parentHub.id } });
  }

  for (const managerSeed of clientManagerCatalog) {
    const { clientSlug, hubAssignments, teamLeaderProfile, ...managerData } = managerSeed;
    const client = await prisma.client.findUniqueOrThrow({
      where: { slug: clientSlug },
    });
    const userData = {
      ...managerData,
      deletedAt: managerData.deletedAt ? new Date(managerData.deletedAt) : null,
    };
    const manager = await prisma.user.upsert({
      where: {
        clientId_mobile: {
          clientId: client.id,
          mobile: managerData.mobile,
        },
      },
      create: { clientId: client.id, ...userData },
      update: userData,
    });

    if (teamLeaderProfile) {
      const teamLeaderData = {
        ...teamLeaderProfile,
        joiningDate: teamLeaderProfile.joiningDate ? new Date(teamLeaderProfile.joiningDate) : null,
        leavingDate: teamLeaderProfile.leavingDate ? new Date(teamLeaderProfile.leavingDate) : null,
        deletedAt: teamLeaderProfile.deletedAt ? new Date(teamLeaderProfile.deletedAt) : null,
      };
      await prisma.teamLeaderProfile.upsert({
        where: { userId: manager.id },
        create: { clientId: client.id, userId: manager.id, ...teamLeaderData },
        update: teamLeaderData,
      });
    }

    for (const { hubCode, isPrimary } of hubAssignments) {
      const hub = await prisma.hub.findFirst({
        where: { clientId: client.id, code: hubCode },
      });
      // Hubs are operational data and may be seeded later than manager users.
      // Re-running the seed will attach any previously unavailable hub mappings.
      if (!hub) continue;
      await prisma.userHub.upsert({
        where: { userId_hubId: { userId: manager.id, hubId: hub.id } },
        create: { clientId: client.id, userId: manager.id, hubId: hub.id, isPrimary },
        update: { isPrimary },
      });
    }
  }

  for (const fleetSeed of fleets) {
    const {
      clientSlug,
      oemCode,
      vehicleCategoryCode,
      vehicleTypeCode,
      homeHubCode,
      currentHubCode,
      registration,
      insurance,
      fitness,
      onboardedAt,
      activatedAt,
      deactivatedAt,
      deletedAt,
      ...fleetData
    } = fleetSeed;
    const [client, oem, vehicleCategory, vehicleType, homeHub, currentHub] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { slug: clientSlug } }),
      prisma.oem.findUniqueOrThrow({ where: { code: oemCode } }),
      prisma.vehicleCategory.findUniqueOrThrow({ where: { code: vehicleCategoryCode } }),
      prisma.vehicleType.findUniqueOrThrow({ where: { code: vehicleTypeCode } }),
      homeHubCode ? prisma.hub.findFirst({ where: { client: { slug: clientSlug }, code: homeHubCode } }) : null,
      currentHubCode ? prisma.hub.findFirst({ where: { client: { slug: clientSlug }, code: currentHubCode } }) : null,
    ]);
    const fleetRecord = {
      ...fleetData,
      clientId: client.id,
      oemId: oem.id,
      vehicleCategoryId: vehicleCategory.id,
      vehicleTypeId: vehicleType.id,
      homeHubId: homeHub?.id ?? null,
      currentHubId: currentHub?.id ?? null,
      onboardedAt: onboardedAt ? new Date(onboardedAt) : null,
      activatedAt: activatedAt ? new Date(activatedAt) : null,
      deactivatedAt: deactivatedAt ? new Date(deactivatedAt) : null,
      deletedAt: deletedAt ? new Date(deletedAt) : null,
    };
    const fleet = await prisma.fleet.upsert({
      where: { clientId_fleetCode: { clientId: client.id, fleetCode: fleetData.fleetCode } },
      create: fleetRecord,
      update: fleetRecord,
    });

    if (registration) {
      const registrationData = {
        ...registration,
        registrationDate: registration.registrationDate ? new Date(registration.registrationDate) : null,
        rcExpiryDate: registration.rcExpiryDate ? new Date(registration.rcExpiryDate) : null,
      };
      await prisma.fleetRegistration.upsert({
        where: { fleetId: fleet.id },
        create: { fleetId: fleet.id, ...registrationData },
        update: registrationData,
      });
    }
    if (insurance) {
      const insuranceData = {
        ...insurance,
        startDate: insurance.startDate ? new Date(insurance.startDate) : null,
        endDate: insurance.endDate ? new Date(insurance.endDate) : null,
      };
      await prisma.fleetInsurance.upsert({
        where: { fleetId: fleet.id },
        create: { fleetId: fleet.id, ...insuranceData },
        update: insuranceData,
      });
    }
    if (fitness) {
      const fitnessData = {
        ...fitness,
        issueDate: fitness.issueDate ? new Date(fitness.issueDate) : null,
        expiryDate: fitness.expiryDate ? new Date(fitness.expiryDate) : null,
        renewalDate: fitness.renewalDate ? new Date(fitness.renewalDate) : null,
      };
      await prisma.fleetFitness.upsert({
        where: { fleetId: fleet.id },
        create: { fleetId: fleet.id, ...fitnessData },
        update: fitnessData,
      });
    }
  }

  for (const deviceSeed of iotDevices) {
    const { clientSlug, installedAt, activatedAt, lastHeartbeatAt, lastLocationAt, ...deviceData } = deviceSeed;
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: clientSlug } });
    const data = {
      ...deviceData,
      installedAt: installedAt ? new Date(installedAt) : null,
      activatedAt: activatedAt ? new Date(activatedAt) : null,
      lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt) : null,
      lastLocationAt: lastLocationAt ? new Date(lastLocationAt) : null,
    };
    await prisma.ioTDevice.upsert({
      where: { clientId_deviceNumber: { clientId: client.id, deviceNumber: deviceData.deviceNumber } },
      create: { clientId: client.id, ...data },
      update: data,
    });
  }

  for (const batterySeed of batteries) {
    const { clientSlug, manufacturingDate, warrantyStartDate, warrantyEndDate, deletedAt, ...batteryData } = batterySeed;
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: clientSlug } });
    const data = {
      ...batteryData,
      manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : null,
      warrantyStartDate: warrantyStartDate ? new Date(warrantyStartDate) : null,
      warrantyEndDate: warrantyEndDate ? new Date(warrantyEndDate) : null,
      deletedAt: deletedAt ? new Date(deletedAt) : null,
    };
    await prisma.battery.upsert({
      where: { clientId_serialNumber: { clientId: client.id, serialNumber: batteryData.serialNumber } },
      create: { clientId: client.id, ...data },
      update: data,
    });
  }

  for (const controllerSeed of controllers) {
    const { clientSlug, deletedAt, ...controllerData } = controllerSeed;
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: clientSlug } });
    const data = { ...controllerData, deletedAt: deletedAt ? new Date(deletedAt) : null };
    await prisma.controller.upsert({
      where: { clientId_controllerNumber: { clientId: client.id, controllerNumber: controllerData.controllerNumber } },
      create: { clientId: client.id, ...data },
      update: data,
    });
  }

  for (const mappingSeed of fleetComponentMappings) {
    const client = await prisma.client.findUniqueOrThrow({ where: { slug: mappingSeed.clientSlug } });
    const fleet = await prisma.fleet.findUniqueOrThrow({
      where: { clientId_fleetCode: { clientId: client.id, fleetCode: mappingSeed.fleetCode } },
    });
    if (mappingSeed.iotDeviceNumber) {
      const iotDevice = await prisma.ioTDevice.findUniqueOrThrow({
        where: { clientId_deviceNumber: { clientId: client.id, deviceNumber: mappingSeed.iotDeviceNumber } },
      });
      await prisma.fleet.update({ where: { id: fleet.id }, data: { iotDeviceId: iotDevice.id } });
    }

    for (const batteryMapping of mappingSeed.batteries) {
      const battery = await prisma.battery.findUniqueOrThrow({
        where: { clientId_serialNumber: { clientId: client.id, serialNumber: batteryMapping.serialNumber } },
      });
      const installedAt = new Date(batteryMapping.installedAt);
      const existing = await prisma.fleetBatteryHistory.findFirst({
        where: { fleetId: fleet.id, batteryId: battery.id, batterySlot: batteryMapping.batterySlot, installedAt },
      });
      const data = {
        removedAt: batteryMapping.removedAt ? new Date(batteryMapping.removedAt) : null,
        installedOdometerKm: batteryMapping.installedOdometerKm,
        removedOdometerKm: batteryMapping.removedOdometerKm,
        reason: batteryMapping.reason,
      };
      if (existing) {
        await prisma.fleetBatteryHistory.update({ where: { id: existing.id }, data });
      } else {
        await prisma.fleetBatteryHistory.create({
          data: { fleetId: fleet.id, batteryId: battery.id, batterySlot: batteryMapping.batterySlot, installedAt, ...data },
        });
      }
    }

    for (const controllerMapping of mappingSeed.controllers) {
      const controller = await prisma.controller.findUniqueOrThrow({
        where: { clientId_controllerNumber: { clientId: client.id, controllerNumber: controllerMapping.controllerNumber } },
      });
      const installedAt = new Date(controllerMapping.installedAt);
      const existing = await prisma.fleetControllerHistory.findFirst({
        where: { fleetId: fleet.id, controllerId: controller.id, installedAt },
      });
      const data = {
        removedAt: controllerMapping.removedAt ? new Date(controllerMapping.removedAt) : null,
        reason: controllerMapping.reason,
      };
      if (existing) {
        await prisma.fleetControllerHistory.update({ where: { id: existing.id }, data });
      } else {
        await prisma.fleetControllerHistory.create({
          data: { fleetId: fleet.id, controllerId: controller.id, installedAt, ...data },
        });
      }
    }
  }

  console.info('Seeded platform master data, client configuration, fleet components, manager users, and Super Admin account.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
