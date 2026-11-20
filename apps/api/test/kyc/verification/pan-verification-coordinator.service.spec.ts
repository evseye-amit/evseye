import { describe, expect, it, vi } from 'vitest';
import { PanVerificationCoordinator } from '../../../src/kyc/verification/pan-verification-coordinator.service.js';

function service(overrides: { feature?: unknown; progress?: unknown; rider?: unknown; consent?: unknown } = {}) {
  const prisma = {
    clientFeature: { findFirst: vi.fn().mockResolvedValue('feature' in overrides ? overrides.feature : { id: 'feature' }) },
    riderOnboardingProgress: { findFirst: vi.fn().mockResolvedValue('progress' in overrides ? overrides.progress : { values: { PAN_NUMBER: 'abcde1234f', FULL_NAME: 'Aman Singh', DATE_OF_BIRTH: '01/01/2000' } }) },
    rider: { findFirst: vi.fn().mockResolvedValue('rider' in overrides ? overrides.rider : { id: 'rider' }) },
    kycConsent: { findFirst: vi.fn().mockResolvedValue('consent' in overrides ? overrides.consent : { id: 'consent' }) },
    appLegalAcceptance: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return new PanVerificationCoordinator(prisma as never, { start: vi.fn().mockResolvedValue({ status: 'PROCESSING' }) } as never, { automated: async () => !('feature' in overrides) || !!overrides.feature } as never);
}

describe('PanVerificationCoordinator', () => {
  it('does not become ready when the client feature is disabled', async () => {
    await expect(service({ feature: null }).readiness('client', 'user')).resolves.toMatchObject({ status: 'DISABLED' });
  });

  it('waits for rider creation before consent or provider execution', async () => {
    await expect(service({ rider: null }).readiness('client', 'user')).resolves.toMatchObject({ status: 'WAITING_FOR_RIDER' });
  });

  it('waits for complete canonical inputs and consent', async () => {
    await expect(service({ progress: { values: { PAN_NUMBER: 'ABCDE1234F' } } }).readiness('client', 'user')).resolves.toMatchObject({ status: 'WAITING_FOR_INPUT' });
    await expect(service({ consent: null }).readiness('client', 'user')).resolves.toMatchObject({ status: 'WAITING_FOR_CONSENT' });
  });

  it('returns normalized inputs only when all prerequisites are present', async () => {
    await expect(service().readiness('client', 'user')).resolves.toMatchObject({ status: 'READY', pan: 'ABCDE1234F' });
  });
});
