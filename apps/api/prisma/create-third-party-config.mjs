import { PrismaClient } from '@prisma/client';

const verificationTypes = [
  'PAN_VERIFICATION',
  'AADHAAR_OTP',
  'BANK_ACCOUNT_VERIFICATION',
  'IFSC_VERIFICATION',
];

const routingPolicies = [
  ['PAN_DEFAULT', 'PAN_VERIFICATION'],
  ['IFSC_DEFAULT', 'IFSC_VERIFICATION'],
];

const decisionRules = [
  {
    code: 'REQUIRED_FAILURE',
    name: 'Required verification failed',
    priority: 10,
    condition: { kind: 'REQUIRED_STEP_FAILED' },
    action: 'MANUAL_REVIEW',
    reasonCode: 'REQUIRED_CHECK_FAILED',
  },
  {
    code: 'IDENTITY_MISMATCH',
    name: 'Identity mismatch',
    priority: 20,
    condition: {
      kind: 'RECONCILIATION_STATUS',
      statuses: ['MISMATCH', 'PARTIAL_MATCH'],
    },
    action: 'MANUAL_REVIEW',
    reasonCode: 'NAME_OR_DOB_MISMATCH',
  },
  {
    code: 'ALL_REQUIRED_PASSED',
    name: 'Required verifications passed',
    priority: 100,
    condition: { kind: 'REQUIRED_STEPS_VERIFIED' },
    action: 'VERIFIED',
    reasonCode: 'ALL_REQUIRED_CHECKS_PASSED',
  },
  {
    code: 'INSUFFICIENT_DATA',
    name: 'Insufficient data',
    priority: 1000,
    condition: { kind: 'ALWAYS' },
    action: 'MANUAL_REVIEW',
    reasonCode: 'INSUFFICIENT_DATA',
  },
];

/**
 * Creates the SANDBOX third-party provider, its routing/capability configuration,
 * and the default rider KYC workflow. Secret values remain outside the database;
 * the configured secret reference is persisted while provider use is enabled or disabled.
 */
export async function createThirdPartyConfig(
  prisma,
  {
    enabled = process.env.KYC_ENABLED === 'true',
    environment = process.env.KYC_SANDBOX_ENVIRONMENT ?? 'TEST',
    secretReference = process.env.KYC_SANDBOX_SECRET_REFERENCE ?? 'env:KYC_SANDBOX_TEST',
  } = {},
) {
  if (!['TEST', 'PRODUCTION'].includes(environment)) {
    throw new Error(`Unsupported KYC provider environment: ${environment}`);
  }

  const sandbox = await prisma.kycProviderConfig.upsert({
    where: { code: 'SANDBOX' },
    create: {
      code: 'SANDBOX',
      name: 'Sandbox',
      environment,
      status: 'ACTIVE',
      isActive: enabled,
    },
    update: { name: 'Sandbox', environment, isActive: enabled },
  });

  for (const verificationType of verificationTypes) {
    const isSupported = verificationType !== 'BANK_ACCOUNT_VERIFICATION';
    const isEnabled = enabled && ['PAN_VERIFICATION', 'IFSC_VERIFICATION'].includes(verificationType);
    await prisma.kycProviderCapability.upsert({
      where: {
        providerId_verificationType: {
          providerId: sandbox.id,
          verificationType,
        },
      },
      create: { providerId: sandbox.id, verificationType, isSupported, isEnabled },
      update: { isSupported, isEnabled },
    });
  }

  for (const [code, verificationType] of routingPolicies) {
    let policy = await prisma.kycRoutingPolicy.findFirst({
      where: { code, version: 1, clientId: null },
    });
    if (!policy) {
      policy = await prisma.kycRoutingPolicy.create({
        data: {
          code,
          name: `${code.replace('_', ' ')} routing`,
          verificationType,
          strategy: 'PRIORITY',
          version: 1,
          isDefault: true,
          maxProvidersPerVerification: 1,
          maxAttempts: 1,
        },
      });
    }
    await prisma.kycRoutingProvider.upsert({
      where: {
        routingPolicyId_providerId: {
          routingPolicyId: policy.id,
          providerId: sandbox.id,
        },
      },
      create: { routingPolicyId: policy.id, providerId: sandbox.id, priority: 1 },
      update: { priority: 1 },
    });
  }

  const credential = await prisma.kycProviderCredential.findFirst({
    where: { providerId: sandbox.id, clientId: null, environment },
    orderBy: { createdAt: 'desc' },
  });
  if (credential) {
    await prisma.kycProviderCredential.update({
      where: { id: credential.id },
      data: { secretReference, status: enabled ? 'ACTIVE' : 'INACTIVE' },
    });
  } else {
    await prisma.kycProviderCredential.create({
      data: {
        providerId: sandbox.id,
        environment,
        secretReference,
        status: enabled ? 'ACTIVE' : 'INACTIVE',
      },
    });
  }

  let definition = await prisma.kycWorkflowDefinition.findFirst({
    where: { code: 'RIDER_DEFAULT_KYC', version: 1, clientId: null },
  });
  if (!definition) {
    definition = await prisma.kycWorkflowDefinition.create({
      data: {
        code: 'RIDER_DEFAULT_KYC',
        name: 'Rider KYC',
        version: 1,
        isDefault: true,
        expiryMinutes: 43200,
        matchThresholds: { strong: 80, partial: 50 },
        description: 'PAN-based rider workflow. Other checks require a new version when enabled.',
      },
    });
  }

  await prisma.kycWorkflowStep.upsert({
    where: {
      workflowDefinitionId_code: {
        workflowDefinitionId: definition.id,
        code: 'PAN',
      },
    },
    create: {
      workflowDefinitionId: definition.id,
      code: 'PAN',
      name: 'PAN verification',
      verificationType: 'PAN_VERIFICATION',
      sequence: 1,
      isRequired: true,
      failureBehavior: 'MANUAL_REVIEW',
      actionMode: 'USER_ACTION',
    },
    update: {
      name: 'PAN verification',
      verificationType: 'PAN_VERIFICATION',
      sequence: 1,
      isRequired: true,
      failureBehavior: 'MANUAL_REVIEW',
      actionMode: 'USER_ACTION',
    },
  });

  for (const rule of decisionRules) {
    const { code, ...data } = rule;
    await prisma.kycDecisionRule.upsert({
      where: {
        code_workflowDefinitionId: {
          code,
          workflowDefinitionId: definition.id,
        },
      },
      create: { code, ...data, workflowDefinitionId: definition.id },
      update: data,
    });
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const prisma = new PrismaClient();
  createThirdPartyConfig(prisma)
    .then(() => console.info('Created SANDBOX provider and rider KYC configuration.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
