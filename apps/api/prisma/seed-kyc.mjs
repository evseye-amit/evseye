export async function seedKyc(prisma, enabled, secretReference = 'env:KYC_SANDBOX_TEST') {
  const sandbox = await prisma.kycProviderConfig.upsert({
    where: { code: 'SANDBOX' },
    create: { code: 'SANDBOX', name: 'Sandbox', environment: 'TEST', status: 'ACTIVE', isActive: enabled },
    update: { name: 'Sandbox', environment: 'TEST', isActive: enabled },
  });
  for (const verificationType of ['PAN_VERIFICATION', 'AADHAAR_OTP', 'BANK_ACCOUNT_VERIFICATION', 'IFSC_VERIFICATION']) {
    await prisma.kycProviderCapability.upsert({
      where: { providerId_verificationType: { providerId: sandbox.id, verificationType } },
      create: { providerId: sandbox.id, verificationType,
        isSupported: verificationType !== 'BANK_ACCOUNT_VERIFICATION',
        isEnabled: enabled && ['PAN_VERIFICATION', 'IFSC_VERIFICATION'].includes(verificationType) },
      update: { isSupported: verificationType !== 'BANK_ACCOUNT_VERIFICATION',
        ...(verificationType === 'BANK_ACCOUNT_VERIFICATION' ? { isEnabled: false } : {}) },
    });
  }
  for (const [code, verificationType] of [['PAN_DEFAULT', 'PAN_VERIFICATION'], ['IFSC_DEFAULT', 'IFSC_VERIFICATION']]) {
    let policy = await prisma.kycRoutingPolicy.findFirst({ where: { code, version: 1, clientId: null } });
    if (!policy) policy = await prisma.kycRoutingPolicy.create({ data: { code, name: `${code.replace('_', ' ')} routing`,
      verificationType, strategy: 'PRIORITY', version: 1, isDefault: true,
      maxProvidersPerVerification: 1, maxAttempts: 1 } });
    if (!await prisma.kycRoutingProvider.findUnique({ where: { routingPolicyId_providerId: { routingPolicyId: policy.id, providerId: sandbox.id } } }))
      await prisma.kycRoutingProvider.create({ data: { routingPolicyId: policy.id, providerId: sandbox.id, priority: 1 } });
  }
  if (enabled) {
    const existing = await prisma.kycProviderCredential.findFirst({
      where: { providerId: sandbox.id, clientId: null, environment: 'TEST', secretReference },
    });
    if (!existing) await prisma.kycProviderCredential.create({ data: {
      providerId: sandbox.id, environment: 'TEST', secretReference,
    } });
  }
  // The seeded journey requires PAN only: Aadhaar OTP and bank account checks are disabled in Phase 1.
  let definition = await prisma.kycWorkflowDefinition.findFirst({ where: { code: 'RIDER_DEFAULT_KYC', version: 1, clientId: null } });
  if (!definition) definition = await prisma.kycWorkflowDefinition.create({ data: {
    code: 'RIDER_DEFAULT_KYC', name: 'Rider KYC', version: 1, isDefault: true,
    expiryMinutes: 43200, matchThresholds: { strong: 80, partial: 50 },
    description: 'PAN-based rider workflow. Other checks require a new version when enabled.',
  } });
  if (!await prisma.kycWorkflowStep.findUnique({ where: { workflowDefinitionId_code: { workflowDefinitionId: definition.id, code: 'PAN' } } }))
    await prisma.kycWorkflowStep.create({ data: { workflowDefinitionId: definition.id, code: 'PAN', name: 'PAN verification',
      verificationType: 'PAN_VERIFICATION', sequence: 1, isRequired: true,
      failureBehavior: 'MANUAL_REVIEW', actionMode: 'USER_ACTION' } });
  const rules = [
    { code: 'REQUIRED_FAILURE', name: 'Required verification failed', priority: 10,
      condition: { kind: 'REQUIRED_STEP_FAILED' }, action: 'MANUAL_REVIEW', reasonCode: 'REQUIRED_CHECK_FAILED' },
    { code: 'IDENTITY_MISMATCH', name: 'Identity mismatch', priority: 20,
      condition: { kind: 'RECONCILIATION_STATUS', statuses: ['MISMATCH', 'PARTIAL_MATCH'] },
      action: 'MANUAL_REVIEW', reasonCode: 'NAME_OR_DOB_MISMATCH' },
    { code: 'ALL_REQUIRED_PASSED', name: 'Required verifications passed', priority: 100,
      condition: { kind: 'REQUIRED_STEPS_VERIFIED' }, action: 'VERIFIED', reasonCode: 'ALL_REQUIRED_CHECKS_PASSED' },
    { code: 'INSUFFICIENT_DATA', name: 'Insufficient data', priority: 1000,
      condition: { kind: 'ALWAYS' }, action: 'MANUAL_REVIEW', reasonCode: 'INSUFFICIENT_DATA' },
  ];
  for (const rule of rules) {
    if (!await prisma.kycDecisionRule.findUnique({ where: {
      code_workflowDefinitionId: { code: rule.code, workflowDefinitionId: definition.id } } }))
      await prisma.kycDecisionRule.create({ data: { ...rule, workflowDefinitionId: definition.id } });
  }
}
