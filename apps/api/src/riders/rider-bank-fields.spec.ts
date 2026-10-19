import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  expandRiderBankComponent,
  riderBankFields,
} from './rider-bank-fields.js';
import { RiderOnboardingConfigurationService } from './rider-onboarding-configuration.service.js';
import { RiderAppService } from './rider-app.service.js';
import type { ResolvedComponent } from '../workflow/workflow-resolver.service.js';

const component: ResolvedComponent = {
  featureId: 'bank-feature',
  featureCode: 'CAPTURE_BANK_ACCOUNT',
  featureName: 'Bank information',
  description: null,
  translations: null,
  billingUnit: 'LIFE_TIME',
  featureVersion: 1,
  componentType: 'FIELD',
  order: 160,
  configuration: {},
  step: {
    id: 'commercial-step',
    code: 'RIDER_COMMERCIALS',
    name: 'Commercial & Payment Details',
    description: null,
    translations: null,
    order: 6,
    parentId: null,
    parentCode: null,
  },
};
function fixture(components = [component]) {
  const workflows = {
    resolve: vi.fn().mockResolvedValue({
      components,
      package: { id: 'package', code: 'BASIC', name: 'Basic' },
    }),
  };
  const resolver = new RiderOnboardingConfigurationService(
    {} as never,
    workflows as never,
  );
  return { resolver, workflows };
}
const required = () => ({
  BANK_ACCOUNT_NUMBER: '00123456789012',
  IFSC_CODE: ' sbin0032386 ',
});

describe('package-controlled rider bank capture', () => {
  it('expands the existing bank feature into exactly six fields in the commercial step', async () => {
    const { resolver } = fixture();
    const result = resolver.toPublicConfiguration(
      await resolver.getEffectiveConfiguration('client'),
    );
    const step = result.onboarding.steps[0];
    expect(step.stepCode).toBe('RIDER_COMMERCIALS');
    expect(step.fields.map((field) => field.fieldCode)).toEqual(
      riderBankFields.map((field) => field.fieldCode),
    );
    expect(
      step.fields
        .filter((field) => field.configuration.required)
        .map((field) => field.fieldCode),
    ).toEqual(['IFSC_CODE', 'BANK_ACCOUNT_NUMBER']);
    expect(step.fields.map((field) => field.configuration.label)).toEqual(
      riderBankFields.map((field) => field.label),
    );
    expect(new Set(step.fields.map((field) => field.featureId))).toEqual(
      new Set(['bank-feature']),
    );
  });
  it('keeps seed defaults consistent with runtime fields', () => {
    const source = readFileSync(
      new URL('../../prisma/catalog/features.mjs', import.meta.url),
      'utf8',
    );
    const line = source
      .split('\n')
      .find((line) => line.includes('"code": "CAPTURE_BANK_ACCOUNT"'))!;
    const feature = JSON.parse(line.trim().replace(/,$/, ''));
    expect(feature.featureStepCode).toBe('RIDER_COMMERCIALS');
    expect(feature.configuration.fields).toEqual(
      riderBankFields.map((field) => ({
        ...field,
        fieldType: 'TEXT',
        dataType: 'STRING',
        editable: true,
        importable: true,
      })),
    );
    expect(
      expandRiderBankComponent({
        ...component,
        configuration: feature.configuration,
      }).map((field) => field.configuration.fieldCode),
    ).toEqual(riderBankFields.map((field) => field.fieldCode));
  });
  it('does not expose or accept bank fields when the feature is excluded or disabled', async () => {
    for (const components of [
      [],
      [{ ...component, configuration: { enabled: false } }],
    ]) {
      const { resolver } = fixture(components);
      expect(
        (await resolver.getEffectiveConfiguration('client')).onboarding.steps,
      ).toEqual([]);
      await expect(
        resolver.validateAndMapValues('client', required(), 'CREATE'),
      ).rejects.toThrow('active package');
    }
  });
  it('normalizes IFSC and persists all fields as strings without losing leading zeroes or existing metadata', async () => {
    const { resolver } = fixture();
    const result = await resolver.validateAndMapValues(
      'client',
      {
        ...required(),
        BANK_NAME: ' State Bank of India ',
        BANK_BRANCH: ' Branch ',
        BANK_CITY: ' City ',
        BANK_STATE: ' State ',
      },
      'EDIT',
      { existing: 'preserved' },
    );
    expect(result.data.metadata).toEqual({
      existing: 'preserved',
      bankAccountNumber: '00123456789012',
      ifscCode: 'SBIN0032386',
      bankName: 'State Bank of India',
      bankBranch: 'Branch',
      bankCity: 'City',
      bankState: 'State',
    });
  });
  it('requires only account number and IFSC, with optional bank descriptors', async () => {
    const { resolver } = fixture();
    await expect(
      resolver.validateAndMapValues('client', required(), 'CREATE'),
    ).resolves.toMatchObject({
      data: { metadata: { ifscCode: 'SBIN0032386' } },
    });
    await expect(
      resolver.validateAndMapValues(
        'client',
        { IFSC_CODE: 'SBIN0032386' },
        'CREATE',
      ),
    ).rejects.toThrow('BANK_ACCOUNT_NUMBER is required');
    await expect(
      resolver.validateAndMapValues(
        'client',
        { BANK_ACCOUNT_NUMBER: '123456789' },
        'CREATE',
      ),
    ).rejects.toThrow('IFSC_CODE is required');
  });
  it.each([
    { IFSC_CODE: 'SBIN1032386' },
    { BANK_ACCOUNT_NUMBER: 123456789 },
    { BANK_ACCOUNT_NUMBER: '1234A5678' },
    { BANK_ACCOUNT_NUMBER: '1'.repeat(41) },
    { BANK_NAME: 'x'.repeat(151) },
    { BANK_CITY: {} },
  ])('rejects malformed bank values: %j', async (invalid) => {
    await expect(
      fixture().resolver.validateAndMapValues(
        'client',
        { ...required(), ...invalid },
        'CREATE',
      ),
    ).rejects.toThrow();
  });
  it('keeps localized labels distinct for the six inputs', async () => {
    const { resolver } = fixture();
    const config = await resolver.getEffectiveConfiguration('client');
    expect(
      new Set(
        resolver
          .toPublicConfiguration(config, 'hi')
          .onboarding.steps[0].fields.map((field) => field.name),
      ).size,
    ).toBe(6);
  });
});

describe('rider app bank step persistence', () => {
  function serviceFixture() {
    const { resolver } = fixture();
    const tx = {
      riderOnboardingProgress: { update: vi.fn() },
      rider: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'rider' }),
        update: vi.fn(),
      },
      riderOnboardingDocument: { updateMany: vi.fn() },
      user: { update: vi.fn() },
    };
    const db = {
      riderOnboardingProgress: {
        findUnique: vi.fn().mockResolvedValue({
          values: {},
          completedStepIds: [],
          skippedStepIds: [],
        }),
      },
      riderOnboardingDocument: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const service = new RiderAppService(
      db as never,
      resolver,
      {} as never,
      { lockUser: vi.fn(), sync: vi.fn() } as never,
    );
    vi.spyOn(service, 'onboarding').mockResolvedValue({
      screen: 'WAITING_FOR_FLEET',
    } as never);
    return { service, tx, db };
  }
  it('saves normalized progress and bank metadata on the created rider', async () => {
    const { service, tx } = serviceFixture();
    await service.saveStep('client', 'user', 'commercial-step', required());
    expect(tx.riderOnboardingProgress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          values: {
            BANK_ACCOUNT_NUMBER: '00123456789012',
            IFSC_CODE: 'SBIN0032386',
          },
        }),
      }),
    );
    expect(tx.rider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            bankAccountNumber: '00123456789012',
            ifscCode: 'SBIN0032386',
          },
        }),
      }),
    );
  });
  it('updates bank details on an existing rider without replacing unrelated metadata', async () => {
    const { service, tx } = serviceFixture();
    tx.rider.findUnique.mockResolvedValue({
      id: 'existing-rider',
      clientId: 'client',
      metadata: { references: ['preserved'] },
    } as never);
    await service.saveStep('client', 'user', 'commercial-step', required());
    expect(tx.rider.create).not.toHaveBeenCalled();
    expect(tx.rider.update).toHaveBeenCalledWith({
      where: { id: 'existing-rider' },
      data: {
        metadata: {
          references: ['preserved'],
          bankAccountNumber: '00123456789012',
          ifscCode: 'SBIN0032386',
        },
      },
    });
  });
  it('rejects invalid or missing required bank fields before saving the step and prevents skipping', async () => {
    const { service, db } = serviceFixture();
    await expect(
      service.saveStep('client', 'user', 'commercial-step', {
        ...required(),
        IFSC_CODE: 'INVALID',
      }),
    ).rejects.toThrow('IFSC_CODE');
    await expect(
      service.saveStep('client', 'user', 'commercial-step', {
        IFSC_CODE: 'SBIN0032386',
      }),
    ).rejects.toThrow('BANK_ACCOUNT_NUMBER');
    await expect(
      service.saveStep('client', 'user', 'commercial-step', {}, true),
    ).rejects.toThrow('required');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
