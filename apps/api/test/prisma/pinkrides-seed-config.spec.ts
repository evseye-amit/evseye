import { describe, expect, it } from 'vitest';

import { pinkridesStagingConfiguration } from '../../prisma/client/pinkrides/staging-configuration.mjs';

describe('Pink Rides staging seed configuration', () => {
  it('contains the complete non-rider client configuration', () => {
    const featureCodes = pinkridesStagingConfiguration.featureOverrides.map(({ code }) => code);

    expect(featureCodes).toHaveLength(81);
    expect(new Set(featureCodes).size).toBe(81);
    expect(pinkridesStagingConfiguration.paymentProviders.map(({ environment }) => environment).sort()).toEqual([
      'PRODUCTION',
      'TEST',
    ]);
    expect(pinkridesStagingConfiguration.workflowOverrides).toEqual([
      expect.objectContaining({
        featureCode: 'SELECT_APP_LANGUAGE',
        configuration: { supportedLocales: ['en', 'hi', 'kn', 'te'] },
      }),
    ]);
    expect(pinkridesStagingConfiguration.pricing).toEqual(
      expect.objectContaining({
        setupDiscountPercent: '40',
        vehicleDiscountPercent: '40',
        setupDiscountValue: '40',
        vehicleDiscountValue: '40',
      }),
    );
  });
});
