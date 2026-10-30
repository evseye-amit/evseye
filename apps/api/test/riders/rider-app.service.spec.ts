import { describe, expect, it, vi } from 'vitest';
import { RiderAppService } from '../../src/riders/rider-app.service.js';
import { RiderOnboardingConfigurationService } from '../../src/riders/rider-onboarding-configuration.service.js';
import { profileAddressFields } from '../../src/riders/rider-profile-values.js';

const kyc = { lockUser: vi.fn(), sync: vi.fn().mockResolvedValue({ kycStatus: 'NOT_STARTED', kycVerifiedAt: null }) };

const configuration = {
  package: { id: 'package-1', code: 'BASIC', name: 'Basic' },
  onboarding: {
    category: 'RIDER_ONBOARDING',
    steps: [{
      stepId: 'step-1', stepCode: 'PROFILE', stepName: 'Profile',
      description: null, parentId: null, sequence: 1, active: true, enabled: true,
      fields: [
        { fieldCode: 'FULL_NAME', storageKey: 'name', fieldType: 'TEXT', dataType: 'STRING', required: true, isUpload: false, editable: true, readOnly: false, disabled: false, validation: {}, configuration: {} },
        { fieldCode: 'MOBILE_NUMBER', storageKey: 'mobile', fieldType: 'MOBILE', dataType: 'STRING', required: true, isUpload: false, editable: false, readOnly: false, disabled: false, validation: {}, configuration: {} },
        { fieldCode: 'DATE_OF_BIRTH', storageKey: 'dateOfBirth', fieldType: 'DATE', dataType: 'DATE', required: false, isUpload: false, editable: true, readOnly: false, disabled: false, validation: {}, configuration: {} },
      ],
    }],
  },
};

function workflowFromLegacyFixture(prisma: any) {
  return { resolve: async () => {
    const { package: pkg } = await prisma.clientSubscription.findFirst();
    return { package: { id: pkg.id, code: pkg.code, name: pkg.name }, components:
      pkg.features.map((assignment: any) => ({
        featureId: assignment.feature.id, featureCode: assignment.feature.code,
        featureName: assignment.feature.name, description: assignment.feature.description,
        billingUnit: assignment.feature.billingUnit, order: assignment.displayOrder,
        configuration: { ...assignment.feature.configuration, ...assignment.configuration },
        step: { id: assignment.feature.featureStep.id, code: assignment.feature.featureStep.code,
          name: assignment.feature.featureStep.displayName,
          description: assignment.feature.featureStep.description,
          parentId: assignment.feature.featureStep.parentId,
          order: assignment.feature.featureStep.displayOrder,
          translations: null },
      })) };
  } };
}

function createService() {
  const transaction = {
    riderOnboardingProgress: { update: vi.fn().mockResolvedValue({}) },
    rider: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
    riderOnboardingDocument: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    riderOnboardingProgress: { findUnique: vi.fn().mockResolvedValue({ clientId: 'client-1', completedStepIds: [], skippedStepIds: [], values: {} }) },
    riderOnboardingDocument: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const resolver = new RiderOnboardingConfigurationService(prisma as never, {} as never);
  vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue(configuration as never);
  const service = new RiderAppService(prisma as never, resolver, {} as never, kyc as never);
  vi.spyOn(service, 'onboarding').mockResolvedValue({ screen: 'WAITING_FOR_FLEET' } as never);
  return { service, prisma, transaction, resolver };
}

const homeSnapshot = (period: string, finalAmount = '123.45') => ({
  currency: 'INR',
  effectiveDate: '2026-10-15',
  rateCard: { id: 'card', code: 'STANDARD', versionId: 'version', version: 1 },
  rider: { id: 'rider-1' },
  vehicle: { id: 'fleet-1' },
  rental: { finalAmount, period },
  totals: { recurringAmount: '999.00', payableToday: '999.00', refundableDepositAmount: '0.00' },
  deposits: [],
  adjustments: [],
});

function createHomeService() {
  const prisma = {
    allocation: { findFirst: vi.fn() },
    riderRentalAgreement: { findFirst: vi.fn() },
  };
  const service = new RiderAppService(prisma as never, {} as never, {} as never, kyc as never);
  return { service, prisma };
}

describe('RiderAppService.home', () => {
  it('returns empty home data and scopes the current allocation to the rider user and client', async () => {
    const { service, prisma } = createHomeService();
    prisma.allocation.findFirst.mockResolvedValue(null);

    await expect(service.home('client-1', 'user-1')).resolves.toEqual({
      partnerName: null,
      businessCategory: null,
      dailyRentalAmount: null,
      rentalDays: 0,
    });
    expect(prisma.allocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        clientId: 'client-1',
        rider: { clientId: 'client-1', userId: 'user-1', deletedAt: null },
        status: { in: ['ACTIVE', 'DEALLOCATION_INITIATED'] },
        allocatedAt: { not: null },
      },
    }));
    expect(prisma.riderRentalAgreement.findFirst).not.toHaveBeenCalled();
  });

  it('uses the current daily commercial version and counts calendar days at the IST boundary', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-16T18:29:59.999Z'));
      const { service, prisma } = createHomeService();
      prisma.allocation.findFirst.mockResolvedValue({
        riderId: 'rider-1',
        fleetId: 'fleet-1',
        allocatedAt: new Date('2026-10-16T18:30:00.000Z'),
        mobileDeployment: { workPartnerName: 'Partner One' },
      });
      prisma.riderRentalAgreement.findFirst.mockResolvedValue({
        currentVehicleId: 'fleet-1',
        currentCommercialVersionNumber: 1,
        pricingSnapshotSchemaVersion: 1,
        statusHistory: [{ changedAt: new Date('2026-10-15T18:30:00.000Z') }],
        commercialVersions: [{ versionNumber: 1, status: 'ACTIVE', pricingSnapshot: homeSnapshot('DAILY') }],
      });

      await expect(service.home('client-1', 'user-1')).resolves.toEqual({
        partnerName: 'Partner One',
        businessCategory: null,
        dailyRentalAmount: '123.45',
        rentalDays: 1,
      });

      vi.setSystemTime(new Date('2026-10-16T18:30:00.000Z'));
      await expect(service.home('client-1', 'user-1')).resolves.toMatchObject({ rentalDays: 2 });
      expect(prisma.riderRentalAgreement.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          clientId: 'client-1',
          riderId: 'rider-1',
          currentVehicleId: 'fleet-1',
          status: { in: ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'TERMINATION_PENDING'] },
        },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps rental days across a vehicle exchange and excludes completed allocations', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
      const { service, prisma } = createHomeService();
      prisma.allocation.findFirst.mockResolvedValue({
        riderId: 'rider-1',
        fleetId: 'fleet-2',
        allocatedAt: new Date('2026-10-17T10:00:00.000Z'),
        mobileDeployment: null,
      });
      prisma.riderRentalAgreement.findFirst.mockResolvedValue({
        currentVehicleId: 'fleet-2',
        currentCommercialVersionNumber: 2,
        pricingSnapshotSchemaVersion: 1,
        statusHistory: [{ changedAt: new Date('2026-10-10T10:00:00.000Z') }],
        commercialVersions: [
          { versionNumber: 1, status: 'INACTIVE', pricingSnapshot: homeSnapshot('WEEKLY', '700.00') },
          { versionNumber: 2, status: 'ACTIVE', pricingSnapshot: homeSnapshot('DAILY', '150.00') },
        ],
      });

      await expect(service.home('client-1', 'user-1')).resolves.toEqual({
        partnerName: null,
        businessCategory: null,
        dailyRentalAmount: '150.00',
        rentalDays: 8,
      });
      expect(prisma.allocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['ACTIVE', 'DEALLOCATION_INITIATED'] } }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the current allocation for a new rental with no agreement', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-10-17T12:00:00.000Z');
      vi.setSystemTime(now);
      const { service, prisma } = createHomeService();
      prisma.allocation.findFirst.mockResolvedValue({
        riderId: 'rider-1',
        fleetId: 'fleet-3',
        allocatedAt: now,
        mobileDeployment: null,
      });
      prisma.riderRentalAgreement.findFirst.mockResolvedValue(null);

      await expect(service.home('client-1', 'user-1')).resolves.toEqual({
        partnerName: null,
        businessCategory: null,
        dailyRentalAmount: null,
        rentalDays: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['WEEKLY', 'MONTHLY'])('returns no daily amount for a %s current rental', async (period) => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-10-17T12:00:00.000Z');
      vi.setSystemTime(now);
      const { service, prisma } = createHomeService();
      prisma.allocation.findFirst.mockResolvedValue({
        riderId: 'rider-1', fleetId: 'fleet-1', allocatedAt: now, mobileDeployment: null,
      });
      prisma.riderRentalAgreement.findFirst.mockResolvedValue({
        currentCommercialVersionNumber: 1,
        pricingSnapshotSchemaVersion: 1,
        statusHistory: [{ changedAt: now }],
        commercialVersions: [{ versionNumber: 1, status: 'ACTIVE', pricingSnapshot: homeSnapshot(period, '700.00') }],
      });

      await expect(service.home('client-1', 'user-1')).resolves.toMatchObject({ dailyRentalAmount: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RiderAppService onboarding step guards', () => {
  it('rejects skipping a step that contains required fields', async () => {
    const { service } = createService();
    await expect(service.saveStep('client-1', 'user-1', 'step-1', {}, true)).rejects.toThrow('cannot be skipped');
  });

  it('rejects completing a later step before prior required steps', async () => {
    const { service, resolver } = createService();
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: {
        ...configuration.onboarding,
        steps: [
          ...configuration.onboarding.steps,
          { ...configuration.onboarding.steps[0], stepId: 'step-2', stepCode: 'BANK', sequence: 2 },
        ],
      },
    } as never);
    await expect(service.saveStep('client-1', 'user-1', 'step-2', { FULL_NAME: 'Rider', MOBILE_NUMBER: '9000000001' })).rejects.toThrow('previous required onboarding step');
  });

  it('rejects saving against a changed onboarding package', async () => {
    const { service, prisma } = createService();
    prisma.riderOnboardingProgress.findUnique.mockResolvedValue({
      clientId: 'client-1', packageId: 'old-package', completedAt: null,
      completedStepIds: [], skippedStepIds: [], values: {},
    });
    await expect(service.saveStep('client-1', 'user-1', 'step-1', { FULL_NAME: 'Rider', MOBILE_NUMBER: '9000000001' })).rejects.toThrow('package changed');
  });
});

describe('RiderAppService.saveStep', () => {
  it('updates the account name before the remaining onboarding steps are complete', async () => {
    const { service, transaction, resolver } = createService();
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [
        ...configuration.onboarding.steps,
        { ...configuration.onboarding.steps[0], stepId: 'documents', fields: [] },
      ] },
    } as never);
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383',
    });
    expect(transaction.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'Aman Singh' } });
    expect(transaction.rider.create).not.toHaveBeenCalled();
    expect(transaction.riderOnboardingProgress.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currentStepId: 'documents' }),
    }));
  });

  it('clears the current step when the final onboarding step is saved', async () => {
    const { service, transaction } = createService();
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383',
    });
    expect(transaction.riderOnboardingProgress.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currentStepId: null }),
    }));
  });

  it('stores configured current and permanent address fields in metadata when onboarding completes', async () => {
    const { service, transaction, resolver } = createService();
    const addressFields = Object.entries(profileAddressFields)
      .filter(([fieldCode]) => /^(CURRENT_ADDRESS|PERMANENT_ADDRESS|SAME_AS_CURRENT_ADDRESS)/.test(fieldCode))
      .map(([fieldCode, storageKey]) => ({
        featureCode: `CAPTURE_${fieldCode}`,
        fieldCode,
        storageKey,
        fieldType: 'TEXT',
        dataType: 'STRING',
        required: false,
        isUpload: false,
        editable: true,
        readOnly: false,
        disabled: false,
        validation: {},
        configuration: {},
      }));
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [{
        ...configuration.onboarding.steps[0],
        fields: [...configuration.onboarding.steps[0].fields, ...addressFields],
      }] },
    } as never);

    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh',
      MOBILE_NUMBER: '6573838383',
      CURRENT_ADDRESS: 'Current address',
      CURRENT_ADDRESS_LINE1: 'Current line 1',
      PERMANENT_ADDRESS: 'Permanent address',
      PERMANENT_ADDRESS_LINE1: 'Permanent line 1',
      SAME_AS_CURRENT_ADDRESS: 'false',
    });

    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({
        currentAddress: 'Current address',
        currentAddressLine1: 'Current line 1',
        permanentAddress: 'Permanent address',
        permanentAddressLine1: 'Permanent line 1',
        sameAsCurrentAddress: 'false',
      }),
    }) });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({
      currentAddress: expect.anything(),
      currentAddressLine1: expect.anything(),
      permanentAddress: expect.anything(),
      permanentAddressLine1: expect.anything(),
      sameAsCurrentAddress: expect.anything(),
    }) });
  });

  it('does not accept onboarding progress owned by another client', async () => {
    const { service, prisma } = createService();
    prisma.riderOnboardingProgress.findUnique.mockResolvedValue({
      clientId: 'other-client', completedStepIds: [], skippedStepIds: [], values: {},
    } as never);
    await expect(service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383',
    })).rejects.toThrow('Rider onboarding has not been started.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('converts a date-only birth date before creating the rider', async () => {
    const { service, transaction } = createService();
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', DATE_OF_BIRTH: '2002-01-22',
    });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: 'Aman Singh', mobile: '+916573838383', dateOfBirth: new Date('2002-01-22T00:00:00.000Z'),
    }) });
    expect(kyc.lockUser).toHaveBeenCalledWith(transaction, 'client-1', 'user-1');
    expect(kyc.sync).toHaveBeenCalledWith(transaction, 'client-1', 'user-1', configuration.onboarding.steps[0].fields);
  });

  it('rejects an invalid birth date before saving onboarding progress', async () => {
    const { service, prisma } = createService();
    await expect(service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', DATE_OF_BIRTH: '2002-02-31',
    })).rejects.toThrow('DATE_OF_BIRTH is invalid.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores a lowercase PAN in uppercase in progress and the Rider profile', async () => {
    const { service, transaction, resolver } = createService();
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [{
        ...configuration.onboarding.steps[0],
        fields: [...configuration.onboarding.steps[0].fields, {
          fieldCode: 'PAN_NUMBER', storageKey: 'metadata.panNumber', fieldType: 'TEXT', dataType: 'STRING',
          required: false, isUpload: false, editable: true, readOnly: false, disabled: false,
          validation: { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' }, configuration: {},
        }],
      }] },
    } as never);
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', PAN_NUMBER: 'abcde1234f',
    });
    expect(transaction.riderOnboardingProgress.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ values: expect.objectContaining({ PAN_NUMBER: 'ABCDE1234F' }) }),
    }));
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ panNumber: 'ABCDE1234F' }),
    }) });
  });

  it('attributes an optional referral code without writing it into Rider profile fields', async () => {
    const { prisma, transaction, resolver } = createService();
    const attribute = vi.fn().mockResolvedValue({ attributed: true });
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [{
        ...configuration.onboarding.steps[0],
        fields: [...configuration.onboarding.steps[0].fields, {
          fieldCode: 'REFERRAL_CODE', storageKey: '', fieldType: 'TEXT', required: false,
          isUpload: false, validation: { pattern: '^EVS-[A-Z2-9]{8}$' }, configuration: {},
        }],
      }] },
    } as never);
    const resolveInput = vi.fn().mockResolvedValue({ referralCode: 'EVS-ABCDEFGH' });
    const service = new RiderAppService(prisma as never, resolver, {} as never, kyc as never, { attribute, resolveInput } as never);
    vi.spyOn(service, 'onboarding').mockResolvedValue({ screen: 'WAITING_FOR_FLEET' } as never);
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', REFERRAL_CODE: 'evs-abcdefgh',
    });
    expect(resolveInput).toHaveBeenCalledWith('client-1', 'evs-abcdefgh');
    expect(attribute).toHaveBeenCalledWith('client-1', 'user-1', { referralCode: 'EVS-ABCDEFGH', source: 'REFERRAL_CODE' });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ referralCode: expect.anything() }) });
  });

  it('passes an invite token from a scanned QR link to attribution', async () => {
    const { prisma, resolver } = createService();
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [{ ...configuration.onboarding.steps[0], fields: [
        ...configuration.onboarding.steps[0].fields,
        { fieldCode: 'REFERRAL_CODE', storageKey: '', fieldType: 'REFERRAL', required: false, isUpload: false, configuration: {} },
      ] }] },
    } as never);
    const attribute = vi.fn().mockResolvedValue({ attributed: true });
    const resolveInput = vi.fn().mockResolvedValue({ referralCode: 'EVS-ABCDEFGH' });
    const service = new RiderAppService(prisma as never, resolver, {} as never, kyc as never, { attribute, resolveInput } as never);
    vi.spyOn(service, 'onboarding').mockResolvedValue({ screen: 'WAITING_FOR_FLEET' } as never);
    const link = 'https://example.test/rider/referral?code=EVS-ABCDEFGH&invite=token-123&campaign=RIDER_BONUS';
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383',
      REFERRAL_CODE: { input: link, source: 'QR_CODE' },
    });
    expect(resolveInput).toHaveBeenCalledWith('client-1', link);
    expect(attribute).toHaveBeenCalledWith('client-1', 'user-1', { referralCode: 'EVS-ABCDEFGH', source: 'QR_CODE', inviteToken: 'token-123', campaignCode: 'RIDER_BONUS' });
  });

  it('enforces the configured reference count and saves structured references', async () => {
    const { service, resolver, transaction, prisma } = createService();
    vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, steps: [{
        ...configuration.onboarding.steps[0],
        fields: [...configuration.onboarding.steps[0].fields, {
          featureCode: 'CAPTURE_REFERENCE', fieldCode: 'RIDER_REFERENCES',
          storageKey: 'metadata.references', fieldType: 'REFERENCE', required: false,
          isUpload: false, editable: true, readOnly: false, disabled: false,
          validation: {}, configuration: { minReferences: 1, maxReferences: 2 },
        }],
      }] },
    } as never);
    const profile = { FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383' };
    const reference = { name: 'Nisha Singh', mobile: '9876543210', relation: 'Sister' };
    await expect(service.saveStep('client-1', 'user-1', 'step-1', { ...profile, RIDER_REFERENCES: [] })).rejects.toThrow('Please provide 1 to 2 references.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await service.saveStep('client-1', 'user-1', 'step-1', { ...profile, RIDER_REFERENCES: [reference] });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ references: [{ ...reference, mobile: '+919876543210' }] }),
    }) });
  });
});

describe('RiderOnboardingConfigurationService', () => {
  it('localizes catalog fields while preserving codes and validation in the public response', () => {
    const resolver = new RiderOnboardingConfigurationService({} as never, {} as never);
    const result = resolver.toPublicConfiguration({
      package: { id: 'package-1', code: 'BASIC', name: 'Basic' },
      onboarding: { category: 'RIDER_ONBOARDING' as never, steps: [{
        stepId: 'step-1', stepCode: 'RIDER_PERSONAL_PROFILE', stepName: 'Personal Profile',
        description: 'Profile', parentId: null, sequence: 1, active: true, enabled: true,
        translations: { kn: { displayName: 'ವೈಯಕ್ತಿಕ ವಿವರಗಳು', description: 'ವಿವರಗಳು' } },
        fields: [{
          fieldId: 'feature-1', featureId: 'feature-1', featureCode: 'CAPTURE_FULL_NAME',
          fieldCode: 'FULL_NAME', storageKey: 'name', fieldName: 'Capture Full Name',
          label: 'Full Name', fieldType: 'TEXT', required: true, readOnly: false,
          disabled: false, editable: true, importable: true, billingUnit: 'LIFE_TIME',
          isUpload: false, sequence: 1, validation: { maxLength: 120 },
          configuration: { fieldCode: 'FULL_NAME', translations: { kn: { label: 'ರೈಡರ್ ಪೂರ್ಣ ಹೆಸರು' } } },
        }],
      }] },
    }, 'kn');
    const step = result.onboarding.steps[0];
    expect(step.stepName).toBe('ವೈಯಕ್ತಿಕ ವಿವರಗಳು');
    expect(step.fields[0]).toMatchObject({
      featureCode: 'CAPTURE_FULL_NAME', fieldCode: 'FULL_NAME', name: 'ಪೂರ್ಣ ಹೆಸರು',
      configuration: { label: 'ರೈಡರ್ ಪೂರ್ಣ ಹೆಸರು', validation: { maxLength: 120 } },
    });
    expect('translations' in step.fields[0].configuration).toBe(false);
  });

  it('returns field identity beside configuration without duplicate rules', async () => {
    const resolver = new RiderOnboardingConfigurationService({} as never, {} as never);
    const result = resolver.toPublicConfiguration({
      package: { id: 'package-1', code: 'BASIC', name: 'Basic' },
      onboarding: { category: 'RIDER_ONBOARDING' as never, steps: [{
        stepId: 'step-1', stepCode: 'DOCUMENTS', stepName: 'Documents',
        description: null, parentId: null, sequence: 1, active: true, enabled: true,
        fields: [{
          fieldId: 'feature-1', featureId: 'feature-1', featureCode: 'ADDRESS_PROOF_DOCUMENT',
          fieldCode: 'ADDRESS_PROOF_DOCUMENT', storageKey: '', fieldName: 'Address proof',
          label: 'Address proof', fieldType: 'TEXT', required: true, readOnly: false,
          disabled: false, editable: true, importable: false, billingUnit: 'UPLOAD',
          isUpload: true, sequence: 1, validation: { maxFiles: 1 },
          configuration: { fieldCode: 'ADDRESS_PROOF_DOCUMENT', required: true, maxFileSizeMB: 5 },
        }],
      }] },
    });
    const field = result.onboarding.steps[0].fields[0];
    expect(field).toEqual({
      featureId: 'feature-1', featureCode: 'ADDRESS_PROOF_DOCUMENT',
      fieldCode: 'ADDRESS_PROOF_DOCUMENT', name: 'Address proof', description: null,
      billingUnit: 'UPLOAD', sequence: 1,
      configuration: {
        required: true, maxFileSizeMB: 5, label: 'Address proof', fieldType: 'UPLOAD',
        readOnly: false, disabled: false, editable: true, importable: false,
        validation: { maxFiles: 1 },
      },
    });
    expect('fieldId' in field).toBe(false);
    expect('required' in field).toBe(false);
    expect('fieldCode' in field.configuration).toBe(false);
  });

  it('resolves an upload feature code when legacy configuration has no fieldCode', async () => {
    const prisma = {
      clientSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          package: {
            id: 'package-1', code: 'BASIC', name: 'Basic',
            features: [{
              isIncluded: true, displayOrder: 1, configuration: null,
              feature: {
                id: 'feature-1', code: 'ADDRESS_PROOF_DOCUMENT', name: 'Address proof',
                description: null, billingUnit: 'UPLOAD', displayOrder: 1,
                configuration: { maxFiles: 1 },
                featureStep: {
                  id: 'step-1', code: 'ADDRESS', displayName: 'Address',
                  description: null, parentId: null, displayOrder: 1, isActive: true,
                },
              },
            }],
          },
        }),
      },
    };
    const resolver = new RiderOnboardingConfigurationService(prisma as never, workflowFromLegacyFixture(prisma) as never);
    const result = await resolver.getEffectiveConfiguration('client-1');
    expect(result.onboarding.steps[0].fields[0]).toMatchObject({
      fieldCode: 'ADDRESS_PROOF_DOCUMENT', isUpload: true,
    });
  });

  it('exposes legacy reference and referral features as onboarding fields', async () => {
    const featureStep = { id: 'step-1', code: 'PROFILE', displayName: 'Profile', description: null, parentId: null, displayOrder: 1, isActive: true };
    const feature = (code: string, configuration: Record<string, unknown>) => ({
      isIncluded: true, displayOrder: 1, configuration: null,
      feature: { id: code, code, name: code, description: null, billingUnit: 'LIFE_TIME', displayOrder: 1, configuration, featureStep },
    });
    const prisma = { clientSubscription: { findFirst: vi.fn().mockResolvedValue({ package: {
      id: 'package-1', code: 'BASIC', name: 'Basic',
      features: [feature('CAPTURE_REFERENCE', { minReferences: 1, maxReferences: 2 }), feature('CAPTURE_REFERRAL', { fieldType: 'MOBILE' })],
    } }) } };
    const resolver = new RiderOnboardingConfigurationService(prisma as never, workflowFromLegacyFixture(prisma) as never);
    const result = resolver.toPublicConfiguration(await resolver.getEffectiveConfiguration('client-1'));
    expect(result.onboarding.steps[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ featureCode: 'CAPTURE_REFERENCE', fieldCode: 'RIDER_REFERENCES', configuration: expect.objectContaining({ fieldType: 'REFERENCE', minReferences: 1, maxReferences: 2, storageKey: 'metadata.references' }) }),
      expect.objectContaining({ featureCode: 'CAPTURE_REFERRAL', fieldCode: 'REFERRAL_CODE' }),
    ]));
  });
});


describe('existing Rider onboarding persistence', () => {
  it('updates personal details and account name without resetting Rider status or metadata', async () => {
    const { service, transaction } = createService();
    transaction.rider.findUnique.mockResolvedValue({ id: 'rider-1', clientId: 'client-1', metadata: { retained: 'value' } } as never);
    await service.saveStep('client-1', 'user-1', 'step-1', { FULL_NAME: 'Updated Name', MOBILE_NUMBER: '9000000001', DATE_OF_BIRTH: '2000-01-02' });
    expect(transaction.rider.update).toHaveBeenCalledWith({ where: { id: 'rider-1' }, data: { name: 'Updated Name', mobile: '+919000000001', dateOfBirth: new Date('2000-01-02') } });
    expect(transaction.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { name: 'Updated Name' } });
    expect(transaction.rider.create).not.toHaveBeenCalled();
  });
});
