import { describe, expect, it, vi } from 'vitest';
import { RiderAppService } from './rider-app.service.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';

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

function createService() {
  const transaction = {
    riderOnboardingProgress: { update: vi.fn().mockResolvedValue({}) },
    rider: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
    riderOnboardingDocument: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    riderOnboardingProgress: { findUnique: vi.fn().mockResolvedValue({ completedStepIds: [], skippedStepIds: [], values: {} }) },
    riderOnboardingDocument: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const resolver = new RiderOnboardingConfigurationService(prisma as never);
  vi.spyOn(resolver, 'getEffectiveConfiguration').mockResolvedValue(configuration as never);
  const service = new RiderAppService(prisma as never, resolver, {} as never);
  vi.spyOn(service, 'onboarding').mockResolvedValue({ screen: 'WAITING_FOR_FLEET' } as never);
  return { service, prisma, transaction, resolver };
}

describe('RiderAppService.saveStep', () => {
  it('converts a date-only birth date before creating the rider', async () => {
    const { service, transaction } = createService();
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', DATE_OF_BIRTH: '2002-01-22',
    });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: 'Aman Singh', mobile: '+916573838383', dateOfBirth: new Date('2002-01-22T00:00:00.000Z'),
    }) });
  });

  it('rejects an invalid birth date before saving onboarding progress', async () => {
    const { service, prisma } = createService();
    await expect(service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', DATE_OF_BIRTH: '2002-02-31',
    })).rejects.toThrow('DATE_OF_BIRTH is invalid.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    const service = new RiderAppService(prisma as never, resolver, {} as never, { attribute } as never);
    vi.spyOn(service, 'onboarding').mockResolvedValue({ screen: 'WAITING_FOR_FLEET' } as never);
    await service.saveStep('client-1', 'user-1', 'step-1', {
      FULL_NAME: 'Aman Singh', MOBILE_NUMBER: '6573838383', REFERRAL_CODE: 'evs-abcdefgh',
    });
    expect(attribute).toHaveBeenCalledWith('client-1', 'user-1', { referralCode: 'EVS-ABCDEFGH' });
    expect(transaction.rider.create).toHaveBeenCalledWith({ data: expect.not.objectContaining({ referralCode: expect.anything() }) });
  });
});

describe('RiderOnboardingConfigurationService', () => {
  it('localizes catalog fields while preserving codes and validation in the public response', () => {
    const resolver = new RiderOnboardingConfigurationService({} as never);
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
    const resolver = new RiderOnboardingConfigurationService({} as never);
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
    const resolver = new RiderOnboardingConfigurationService(prisma as never);
    const result = await resolver.getEffectiveConfiguration('client-1');
    expect(result.onboarding.steps[0].fields[0]).toMatchObject({
      fieldCode: 'ADDRESS_PROOF_DOCUMENT', isUpload: true,
    });
  });
});
