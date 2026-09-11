import { PhotoEntityType, PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: { name: 'EVs Eye Demo', isActive: true },
    create: { slug: 'demo', name: 'EVs Eye Demo' },
  });

  await prisma.user.upsert({
    where: {
      tenantId_mobile: { tenantId: tenant.id, mobile: '+919000000000' },
    },
    update: {
      name: 'Demo Tenant Admin',
      role: UserRole.TENANT_ADMIN,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      mobile: '+919000000000',
      name: 'Demo Tenant Admin',
      role: UserRole.TENANT_ADMIN,
    },
  });

  const inspectionPhotoTypes = [
    'FRONT',
    'REAR',
    'LEFT',
    'RIGHT',
    'ODOMETER',
    'BATTERY',
    'CONTROLLER',
    'TYRES',
    'BRAKES',
    'LIGHTS',
    'CHARGER',
    'KEYS',
  ];
  const fleetPhotoTypes = ['FRONT', 'REAR', 'LEFT', 'RIGHT', 'DASHBOARD'];
  const batteryPhotoTypes = ['FRONT', 'REAR', 'LABEL', 'CONNECTOR'];
  const controllerPhotoTypes = ['FRONT', 'LABEL'];
  const requirements = [
    { entityType: PhotoEntityType.RIDER, photoType: 'PROFILE' },
    ...fleetPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.FLEET,
      photoType,
    })),
    ...batteryPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.BATTERY,
      photoType,
    })),
    ...controllerPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.CONTROLLER,
      photoType,
    })),
    ...inspectionPhotoTypes.map((photoType) => ({
      entityType: PhotoEntityType.INSPECTION,
      photoType,
    })),
  ];
  await Promise.all(
    requirements.map(({ entityType, photoType }, sortOrder) =>
      prisma.photoRequirement.upsert({
        where: {
          tenantId_entityType_photoType: {
            tenantId: tenant.id,
            entityType,
            photoType,
          },
        },
        create: {
          tenantId: tenant.id,
          entityType,
          photoType,
          isRequired: true,
          sortOrder,
        },
        update: {},
      }),
    ),
  );

  console.info('Seeded tenant "demo", administrator, and photo requirements.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
