import { PhotoEntityType, PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { tenantId: null, mobile: '+919100000000' },
  });
  const superAdmin = existingSuperAdmin
    ? await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          name: 'EVs Eye Super Admin',
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
      })
    : await prisma.user.create({
        data: {
          mobile: '+919100000000',
          name: 'EVs Eye Super Admin',
          role: UserRole.SUPER_ADMIN,
        },
      });

  const onboardingSteps = [
    [
      'mobile_otp',
      'Mobile number + OTP',
      1,
      'identity',
      true,
      true,
      true,
      false,
    ],
    ['basic_profile', 'Basic profile', 1, 'identity', false, true, true, false],
    ['hub_selection', 'Hub selection', 1, 'identity', false, true, true, false],
    [
      'aadhaar_kyc',
      'Aadhaar offline eKYC',
      1,
      'identity',
      true,
      true,
      true,
      true,
    ],
    [
      'dl_verification',
      'Driving licence verification',
      2,
      'compliance',
      false,
      true,
      true,
      true,
    ],
    [
      'age_eligibility',
      'Age eligibility',
      2,
      'compliance',
      false,
      true,
      true,
      false,
    ],
    [
      'address_proof',
      'Address proof',
      2,
      'compliance',
      false,
      true,
      true,
      true,
    ],
    [
      'emergency_contact',
      'Emergency contact',
      2,
      'compliance',
      false,
      true,
      true,
      false,
    ],
    [
      'engagement_model',
      'Engagement model',
      3,
      'commercial',
      false,
      true,
      true,
      false,
    ],
    [
      'plan_selection',
      'Plan selection',
      3,
      'commercial',
      false,
      true,
      true,
      false,
    ],
    [
      'security_deposit',
      'Security deposit',
      3,
      'commercial',
      false,
      false,
      true,
      false,
    ],
    [
      'bank_verification',
      'Bank account verification',
      3,
      'commercial',
      false,
      true,
      true,
      false,
    ],
    [
      'agreement_esign',
      'Agreement e-signature',
      3,
      'commercial',
      true,
      true,
      true,
      false,
    ],
    [
      'final_approval',
      'Final approval',
      5,
      'readiness',
      false,
      true,
      true,
      false,
    ],
    ['activation', 'Rider activation', 5, 'readiness', true, true, true, false],
  ].map(
    ([
      stepKey,
      displayName,
      stage,
      category,
      isLockable,
      defaultEnabled,
      defaultMandatory,
      supportsDocument,
    ]) => ({
      stepKey,
      displayName,
      stage,
      category,
      isLockable,
      defaultEnabled,
      defaultMandatory,
      supportsDocument,
    }),
  );

  await Promise.all(
    onboardingSteps.map((step) =>
      prisma.onboardingStepDefinition.upsert({
        where: { stepKey: step.stepKey },
        create: {
          ...step,
          handlerClass: `${step.stepKey}.handler`,
          uiComponent: step.stepKey,
          // The platform owns the onboarding master catalog. Tenant-side change
          // requests will be introduced as a separate, approval-gated workflow.
          tenantEditable: false,
          requiresOpsApproval: true,
          schemaDefinition: {},
        },
        update: {
          displayName: step.displayName,
          stage: step.stage,
          category: step.category,
          isLockable: step.isLockable,
          defaultEnabled: step.defaultEnabled,
          defaultMandatory: step.defaultMandatory,
          supportsDocument: step.supportsDocument,
        },
      }),
    ),
  );

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
      name: 'Demo Client Admin',
      role: UserRole.TENANT_ADMIN,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      mobile: '+919000000000',
      name: 'Demo Client Admin',
      role: UserRole.TENANT_ADMIN,
    },
  });

  const activeConfig = await prisma.riderOnboardingConfig.findFirst({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
  });
  if (!activeConfig) {
    await prisma.riderOnboardingConfig.create({
      data: {
        tenantId: tenant.id,
        version: 1,
        status: 'ACTIVE',
        createdById: superAdmin.id,
        activatedAt: new Date(),
        effectiveFrom: new Date(),
        notes: 'Platform default rider onboarding configuration.',
        steps: {
          create: onboardingSteps.map((step, index) => ({
            stepKey: step.stepKey,
            enabled: step.defaultEnabled,
            mandatory: step.defaultMandatory,
            sequenceNo: index + 1,
            dependsOn: [],
            params: {},
          })),
        },
      },
    });
  }

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

  console.info(
    'Seeded platform super admin, client "demo", onboarding configuration, administrator, and photo requirements.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
