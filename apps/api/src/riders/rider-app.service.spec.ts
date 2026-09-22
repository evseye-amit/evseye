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
  return { service, prisma, transaction };
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
});
