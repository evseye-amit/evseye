import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const TEST_RIDER_COUNT = 10;
export const TEST_SEED_KEY = 'YOGMAYA_STAGING_TEST_RIDERS';
export const TEST_SEED_VERSION = 1;
const REFERENCE_FIELD_KEY = 'metadata.references';
const STAGING_RDS_HOST =
  /^evseye-staging-postgres\.[a-z0-9-]+\.ap-south-1\.rds\.amazonaws\.com$/i;

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' ? value : '');

const riderBankFields = [
  {
    fieldCode: 'IFSC_CODE',
    storageKey: 'metadata.ifscCode',
    required: true,
    fieldType: 'TEXT',
  },
  {
    fieldCode: 'BANK_NAME',
    storageKey: 'metadata.bankName',
    required: false,
    fieldType: 'TEXT',
  },
  {
    fieldCode: 'BANK_BRANCH',
    storageKey: 'metadata.bankBranch',
    required: false,
    fieldType: 'TEXT',
  },
  {
    fieldCode: 'BANK_CITY',
    storageKey: 'metadata.bankCity',
    required: false,
    fieldType: 'TEXT',
  },
  {
    fieldCode: 'BANK_STATE',
    storageKey: 'metadata.bankState',
    required: false,
    fieldType: 'TEXT',
  },
  {
    fieldCode: 'BANK_ACCOUNT_NUMBER',
    storageKey: 'metadata.bankAccountNumber',
    required: true,
    fieldType: 'TEXT',
  },
];

const directRiderKeys = new Set([
  'name',
  'mobile',
  'address',
  'dateOfBirth',
  'gender',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'emergencyContactName',
  'emergencyContactMobile',
  'joiningDate',
]);
const metadataProfileKeys = new Set([
  'currentAddress',
  'currentAddressLine1',
  'currentAddressLine2',
  'currentAddressCity',
  'currentAddressState',
  'currentAddressPincode',
  'permanentAddress',
  'permanentAddressLine1',
  'permanentAddressLine2',
  'permanentAddressCity',
  'permanentAddressState',
  'permanentAddressPincode',
  'sameAsCurrentAddress',
]);

const localMobile = (index) => `97000000${String(index).padStart(2, '0')}`;
const normalizedMobile = (index) => `+91${localMobile(index)}`;
const referenceMobile = (index, referenceIndex) =>
  `+91${`980000${String(index).padStart(2, '0')}${String(referenceIndex).padStart(2, '0')}`}`;

export function validateStagingDatabaseUrl(
  connectionString,
  nodeEnv = process.env.NODE_ENV,
) {
  if (nodeEnv === 'production') {
    throw new Error(
      'The Yogmaya staging test-rider seed cannot run with NODE_ENV=production.',
    );
  }
  if (nodeEnv !== 'development') {
    throw new Error(
      'The Yogmaya staging test-rider seed requires NODE_ENV=development.',
    );
  }
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error(
      'DATABASE_URL is required for the Yogmaya staging test-rider seed.',
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL for the direct Yogmaya staging RDS target.',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !STAGING_RDS_HOST.test(parsed.hostname) ||
    parsed.pathname !== '/evseye' ||
    (parsed.port && parsed.port !== '5432')
  ) {
    throw new Error(
      'DATABASE_URL must target evseye-staging-postgres.<id>.ap-south-1.rds.amazonaws.com/evseye on the default PostgreSQL port; localhost tunnels and non-staging databases are unsupported.',
    );
  }
  const queryKeys = [...parsed.searchParams.keys()];
  if (
    queryKeys.some((key) => !['schema', 'sslmode'].includes(key)) ||
    new Set(queryKeys).size !== queryKeys.length
  ) {
    throw new Error(
      'DATABASE_URL may only use the schema and sslmode query keys; target overrides such as host, port, and dbname are unsupported.',
    );
  }
  return connectionString;
}

function marker(index) {
  return {
    key: TEST_SEED_KEY,
    version: TEST_SEED_VERSION,
    index,
    synthetic: true,
  };
}

function referenceId(clientId, ownerKey, reference) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        clientId,
        ownerKey,
        REFERENCE_FIELD_KEY,
        reference.name,
        reference.mobile,
        reference.relation,
      ]),
    )
    .digest('hex');
}

function fieldConfiguration(field) {
  return object(field?.configuration);
}

function fieldValue(field, index, riderName, references) {
  const code = text(field.fieldCode).toUpperCase();
  const dateOfBirth = '1995-04-15';
  const values = {
    MOBILE_NUMBER: localMobile(index),
    FULL_NAME: riderName,
    GENDER: 'OTHER',
    DATE_OF_BIRTH: dateOfBirth,
    ADDRESS: 'Synthetic QA address, Yogmaya staging',
    ADDRESS_LINE1: 'Synthetic QA address, Yogmaya staging',
    ADDRESS_LINE2: 'Test-only fixture',
    CURRENT_ADDRESS: 'Synthetic QA address, Yogmaya staging',
    CURRENT_ADDRESS_LINE1: 'Synthetic QA address, Yogmaya staging',
    CURRENT_ADDRESS_LINE2: 'Test-only fixture',
    CURRENT_ADDRESS_CITY: 'Guwahati',
    CURRENT_ADDRESS_STATE: 'Assam',
    CURRENT_ADDRESS_PINCODE: '781001',
    PERMANENT_ADDRESS: 'Synthetic QA address, Yogmaya staging',
    PERMANENT_ADDRESS_LINE1: 'Synthetic QA address, Yogmaya staging',
    PERMANENT_ADDRESS_LINE2: 'Test-only fixture',
    PERMANENT_ADDRESS_CITY: 'Guwahati',
    PERMANENT_ADDRESS_STATE: 'Assam',
    PERMANENT_ADDRESS_PINCODE: '781001',
    SAME_AS_CURRENT_ADDRESS: 'true',
    AADHAAR_NUMBER: `9999999999${String(index).padStart(2, '0')}`,
    PAN_NUMBER: `AAAAA${String(index).padStart(4, '0')}A`,
    DRIVING_LICENSE: `TEST-DL-${String(index).padStart(2, '0')}`,
    IFSC_CODE: 'TEST0000001',
    IFSC: 'TEST0000001',
    BANK_NAME: 'Synthetic Test Bank',
    BANK_BRANCH: 'Staging Test Branch',
    BANK_CITY: 'Guwahati',
    BANK_STATE: 'Assam',
    ACCOUNT_HOLDER_NAME: riderName,
    BANK_ACCOUNT_NUMBER: `91000000${String(index).padStart(2, '0')}01`,
    REPEAT_BANK_ACCOUNT_NUMBER: `91000000${String(index).padStart(2, '0')}01`,
    REFERENCES: references,
    RIDER_REFERENCES: references,
    SECURITY_DEPOSIT: '0',
    ONBOARDING_FEES: '0',
    RENTAL_PLAN: 'DAILY',
  };
  if (Object.prototype.hasOwnProperty.call(values, code)) return values[code];

  const configuration = fieldConfiguration(field);
  if (configuration.fieldType === 'REFERENCE' || code.includes('REFERENCE'))
    return references;
  return undefined;
}

function addRiderValue(field, value, rider, metadata) {
  const storageKey = text(field.storageKey);
  if (!storageKey) return;
  if (storageKey.startsWith('metadata.')) {
    metadata[storageKey.slice('metadata.'.length)] = value;
    return;
  }
  if (metadataProfileKeys.has(storageKey)) {
    metadata[storageKey] = value;
    return;
  }
  if (!directRiderKeys.has(storageKey)) {
    if (
      field.required &&
      !field.disabled &&
      field.editable !== false &&
      field.readOnly !== true
    ) {
      throw new Error(
        `Required active onboarding field ${field.fieldCode} uses unsupported Rider storage key ${storageKey}.`,
      );
    }
    return;
  }
  if (storageKey === 'dateOfBirth')
    rider[storageKey] = new Date(`${value}T00:00:00.000Z`);
  else if (storageKey === 'joiningDate')
    rider[storageKey] = new Date(`${value}T00:00:00.000Z`);
  else rider[storageKey] = value;
}

/**
 * Build only synthetic records. No database calls or external approvals happen here.
 */
export function buildTestRiderFixtures({
  clientId,
  packageId,
  steps,
  reviewerId,
  now = new Date(),
}) {
  if (
    !clientId ||
    !packageId ||
    !reviewerId ||
    !Array.isArray(steps) ||
    !steps.length
  ) {
    throw new Error(
      'A Yogmaya client, published onboarding package, onboarding steps, and reviewer are required.',
    );
  }

  const stepIds = steps.map((step) => text(step.stepId)).filter(Boolean);
  if (!stepIds.length)
    throw new Error('The active onboarding workflow has no step IDs.');

  return Array.from({ length: TEST_RIDER_COUNT }, (_, offset) => {
    const index = offset + 1;
    const riderName = `Yogmaya Staging Test Rider ${String(index).padStart(2, '0')}`;
    const referencesField = steps
      .flatMap((step) => array(step.fields))
      .find((field) => {
        const code = text(field.fieldCode).toUpperCase();
        const configuration = fieldConfiguration(field);
        return (
          code === 'REFERENCES' ||
          code === 'RIDER_REFERENCES' ||
          configuration.fieldType === 'REFERENCE'
        );
      });
    const configuredReferences = Number(
      referencesField?.minReferences ??
        fieldConfiguration(referencesField).minReferences ??
        1,
    );
    const referenceCount = Number.isFinite(configuredReferences)
      ? Math.max(1, configuredReferences)
      : 1;
    const references = Array.from(
      { length: referenceCount },
      (_, referenceOffset) => ({
        name: `Synthetic Reference ${String(index).padStart(2, '0')}-${referenceOffset + 1}`,
        mobile: referenceMobile(index, referenceOffset + 1),
        relation: 'Staging QA reference',
      }),
    );

    const onboardingValues = {};
    const rider = {
      clientId,
      riderCode: `YOGMAYA-STAGING-TEST-${String(index).padStart(2, '0')}`,
      name: riderName,
      mobile: normalizedMobile(index),
      status: 'ACTIVE',
      kycStatus: 'NOT_STARTED',
      kycVerifiedAt: null,
      deletedAt: null,
    };
    const metadata = { testSeed: marker(index) };
    const fieldCodes = new Set();

    for (const step of steps) {
      for (const field of array(step.fields)) {
        const fieldCode = text(field.fieldCode);
        if (!fieldCode || fieldCodes.has(fieldCode)) continue;
        fieldCodes.add(fieldCode);
        const value = fieldValue(field, index, riderName, references);
        if (value === undefined) {
          if (field.required && !field.disabled) {
            throw new Error(
              `Required active onboarding field ${fieldCode} has no synthetic fixture value. Add an explicit test-only value or obtain authority for its evidence.`,
            );
          }
          continue;
        }
        onboardingValues[fieldCode] = value;
        addRiderValue(field, value, rider, metadata);
      }
    }

    rider.mobile = normalizedMobile(index);
    if (!rider.name || !rider.mobile)
      throw new Error(
        'The active onboarding workflow must provide name and mobile fields.',
      );
    if (
      !Array.isArray(metadata.references) ||
      metadata.references.length < referenceCount
    ) {
      throw new Error(
        'The active onboarding workflow must persist synthetic references in rider metadata.',
      );
    }
    rider.metadata = metadata;

    const user = {
      clientId,
      name: riderName,
      mobile: normalizedMobile(index),
      role: 'RIDER',
      isActive: true,
      deletedAt: null,
    };
    const onboarding = {
      clientId,
      packageId,
      currentStepId: null,
      completedStepIds: stepIds,
      skippedStepIds: [],
      values: onboardingValues,
      completedAt: new Date(now),
    };
    const referenceRecords = references.map((reference) => ({
      clientId,
      ownerKey: `user:fixture-${index}`,
      name: reference.name,
      mobile: reference.mobile,
      relation: reference.relation,
      status: 'APPROVED',
      rejectionReason: null,
      reviewedById: reviewerId,
      reviewedAt: new Date(now),
    }));

    return {
      index,
      user,
      rider,
      onboarding,
      references: referenceRecords[0],
      referenceRecords,
    };
  });
}

function workflowStepsFromRevision(snapshot, clientRevisionSnapshot) {
  const overrides = new Map(
    array(object(clientRevisionSnapshot).overrides)
      .map((value) => object(value))
      .filter((value) => typeof value.featureId === 'string')
      .map((value) => [value.featureId, value]),
  );
  const grouped = new Map();
  for (const entry of array(object(snapshot).features)) {
    const feature = object(entry.feature);
    if (feature.category !== 'RIDER_ONBOARDING' || feature.isActive === false)
      continue;
    const featureId = text(entry.featureId) || text(feature.id);
    const override = overrides.get(featureId) ?? {};
    if (override.enabled === false) continue;
    const configuration = {
      ...object(feature.configuration),
      ...object(override.configuration),
      validation: {
        ...object(feature.configuration?.validation),
        ...object(override.configuration?.validation),
      },
    };
    const appCodes = configuration.appCodes ?? configuration.loginAppCodes;
    if (Array.isArray(appCodes) && !appCodes.includes('RIDER')) continue;
    if (configuration.enabled === false) continue;
    const step = object(feature.step);
    const stepCode = text(step.code);
    if (!stepCode) continue;
    const stepId = text(step.id) || stepCode;
    const fields = grouped.get(stepId)?.fields ?? [];
    const featureCode = text(feature.code);
    if (featureCode === 'CAPTURE_BANK_ACCOUNT') {
      const customFields = array(configuration.fields);
      for (const base of riderBankFields) {
        const custom =
          customFields
            .map(object)
            .find((value) => value.fieldCode === base.fieldCode) ?? {};
        fields.push({
          ...base,
          ...custom,
          fieldCode: base.fieldCode,
          storageKey: base.storageKey,
          editable: custom.editable !== false,
          readOnly: custom.readOnly === true,
          configuration: {
            ...configuration,
            ...custom,
            validation: { ...base.validation, ...object(custom.validation) },
          },
        });
      }
    } else {
      fields.push({
        fieldCode:
          text(configuration.fieldCode) ||
          (featureCode === 'CAPTURE_REFERENCE'
            ? 'RIDER_REFERENCES'
            : feature.billingUnit === 'UPLOAD'
              ? featureCode
              : ''),
        storageKey:
          text(configuration.storageKey) ||
          (featureCode === 'CAPTURE_REFERENCE' ? 'metadata.references' : ''),
        fieldType:
          text(configuration.fieldType) ||
          (featureCode === 'CAPTURE_REFERENCE' ? 'REFERENCE' : 'TEXT'),
        required: configuration.required === true,
        disabled: configuration.disabled === true,
        editable: configuration.editable !== false,
        readOnly: configuration.readOnly === true,
        minReferences: configuration.minReferences,
        configuration,
      });
    }
    grouped.set(stepId, { stepId, order: Number(step.order ?? 0), fields });
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        left.order - right.order || left.stepId.localeCompare(right.stepId),
    )
    .map(({ stepId, fields }) => ({ stepId, fields }));
}

async function activeWorkflow(prisma, clientId, now) {
  const subscription = await prisma.clientSubscription.findFirst({
    where: {
      clientId,
      status: 'ACTIVE',
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      packageId: true,
      package: { select: { code: true } },
      packageRevision: {
        select: { id: true, snapshot: true, publishedAt: true },
      },
    },
  });
  if (!subscription)
    throw new Error('Yogmaya has no active subscription for rider onboarding.');

  let revision = subscription.packageRevision;
  if (!revision) {
    revision = await prisma.packageRevision.findFirst({
      where: { packageId: subscription.packageId, publishedAt: { not: null } },
      orderBy: { version: 'desc' },
      select: { id: true, snapshot: true, publishedAt: true },
    });
  }
  if (!revision?.publishedAt)
    throw new Error(
      'Yogmaya has no published rider onboarding package revision.',
    );
  const clientRevision = prisma.clientWorkflowRevision?.findFirst
    ? await prisma.clientWorkflowRevision.findFirst({
        where: {
          subscriptionId: subscription.id,
          publishedAt: { not: null },
          snapshot: { path: ['packageRevisionId'], equals: revision.id },
        },
        orderBy: { version: 'desc' },
        select: { snapshot: true },
      })
    : null;
  const snapshot = object(revision.snapshot);
  const packageId = text(snapshot.id) || subscription.packageId;
  const steps = workflowStepsFromRevision(snapshot, clientRevision?.snapshot);
  if (!steps.length)
    throw new Error('Yogmaya has no active RIDER_ONBOARDING steps.');
  return { packageId, steps };
}

function ownedRider(rider, index) {
  const testSeed = object(object(rider?.metadata).testSeed);
  return (
    testSeed.key === TEST_SEED_KEY &&
    testSeed.version === TEST_SEED_VERSION &&
    testSeed.index === index
  );
}

function assertSafeExisting(
  index,
  existingUser,
  existingRider,
  existingRiderByCode,
) {
  if (!existingUser && !existingRider && !existingRiderByCode) return;
  if (!existingUser && !existingRider && existingRiderByCode) {
    throw new Error(
      `Synthetic rider ${index} rider code belongs to an unrelated rider; refusing to overwrite it.`,
    );
  }
  if (!existingUser || !existingRider) {
    throw new Error(
      `Synthetic rider ${index} has a partial existing user/rider pair; refusing to overwrite it.`,
    );
  }
  if (existingUser.role !== 'RIDER' || existingUser.clientId === null) {
    throw new Error(
      `Synthetic rider ${index} mobile belongs to a non-rider user; refusing to overwrite it.`,
    );
  }
  if (existingUser.isActive === false || existingUser.deletedAt) {
    throw new Error(
      `Synthetic rider ${index} already has an inactive user; refusing to reset it.`,
    );
  }
  if (
    existingRider.deletedAt ||
    (existingRider.status !== undefined && existingRider.status !== 'ACTIVE')
  ) {
    throw new Error(
      `Synthetic rider ${index} already has a non-active rider record; refusing to reset it.`,
    );
  }
  if (
    existingRider.userId !== existingUser.id ||
    !ownedRider(existingRider, index) ||
    (existingRiderByCode && existingRiderByCode.id !== existingRider.id)
  ) {
    throw new Error(
      `Synthetic rider ${index} mobile belongs to an unrelated rider; refusing to overwrite it.`,
    );
  }
}

export async function seedYogmayaTestRiders(prisma, { now = new Date() } = {}) {
  const client = await prisma.client.findUnique({
    where: { slug: 'yogmaya' },
    select: { id: true },
  });
  if (!client)
    throw new Error(
      'Yogmaya client does not exist; run the normal Yogmaya seed first.',
    );

  const reviewer = await prisma.user.findFirst({
    where: {
      clientId: client.id,
      isActive: true,
      deletedAt: null,
      role: { in: ['CLIENT_ADMIN', 'KYC_OPERATOR', 'FLEET_MANAGER'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!reviewer)
    throw new Error(
      'A client-scoped active reviewer is required for synthetic reference review rows.',
    );

  const workflow = await activeWorkflow(prisma, client.id, now);
  const fixtures = buildTestRiderFixtures({
    clientId: client.id,
    packageId: workflow.packageId,
    steps: workflow.steps,
    reviewerId: reviewer.id,
    now,
  });
  const writeBatch = async (tx) => {
    const existing = [];
    for (const fixture of fixtures) {
      const user = await tx.user.findUnique({
        where: {
          clientId_mobile: {
            clientId: client.id,
            mobile: fixture.user.mobile,
          },
        },
        select: {
          id: true,
          clientId: true,
          role: true,
          isActive: true,
          deletedAt: true,
        },
      });
      const rider = await tx.rider.findUnique({
        where: {
          clientId_mobile: {
            clientId: client.id,
            mobile: fixture.user.mobile,
          },
        },
        select: {
          id: true,
          userId: true,
          metadata: true,
          status: true,
          deletedAt: true,
        },
      });
      const riderByCode = await tx.rider.findUnique({
        where: {
          clientId_riderCode: {
            clientId: client.id,
            riderCode: fixture.rider.riderCode,
          },
        },
        select: { id: true, userId: true, metadata: true },
      });
      assertSafeExisting(fixture.index, user, rider, riderByCode);
      if (rider) {
        const unfinishedAllocation = await tx.allocation.findFirst({
          where: {
            clientId: client.id,
            riderId: rider.id,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
          select: { id: true, status: true },
        });
        if (unfinishedAllocation) {
          throw new Error(
            `Synthetic rider ${fixture.index} (${fixture.rider.riderCode}, ${fixture.user.mobile}) has unfinished allocation ${unfinishedAllocation.id} (${unfinishedAllocation.status}); refusing to rerun without changing rental state.`,
          );
        }
      }
      existing.push({ fixture, user, rider });
    }

    const seeded = [];
    for (const {
      fixture,
      user: existingUser,
      rider: existingRider,
    } of existing) {
      const user =
        existingUser ?? (await tx.user.create({ data: fixture.user }));
      const rider =
        existingRider ??
        (await tx.rider.create({
          data: { ...fixture.rider, userId: user.id },
        }));
      await tx.riderOnboardingProgress.upsert({
        where: { userId: user.id },
        create: { ...fixture.onboarding, userId: user.id },
        update: {},
      });
      for (const reference of fixture.referenceRecords) {
        const ownerKey = `user:${user.id}`;
        const id = referenceId(client.id, ownerKey, reference);
        await tx.riderReferenceReview.upsert({
          where: { id },
          create: { ...reference, id, ownerKey },
          update: {},
        });
      }
      seeded.push({
        index: fixture.index,
        userId: user.id,
        riderId: rider.id,
        mobile: fixture.user.mobile,
      });
    }
    return seeded;
  };
  return prisma.$transaction(writeBatch);
}

async function main() {
  if (process.env.SEED_YOGMAYA_TEST_RIDERS !== '1') {
    throw new Error(
      'Refusing to run the test-rider seed without SEED_YOGMAYA_TEST_RIDERS=1.',
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'The Yogmaya staging test-rider seed cannot run with NODE_ENV=production.',
    );
  }
  const databaseUrl = validateStagingDatabaseUrl(
    process.env.DATABASE_URL,
    process.env.NODE_ENV,
  );
  const { createPrismaClient } = await import('./prisma-client.mjs');
  const prisma = createPrismaClient(databaseUrl);
  try {
    const seeded = await seedYogmayaTestRiders(prisma);
    console.log(
      `Seeded ${seeded.length} synthetic Yogmaya staging riders (${TEST_SEED_KEY}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
