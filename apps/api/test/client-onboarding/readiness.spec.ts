import { describe, expect, it, vi } from 'vitest';
import { ClientOnboardingReadinessService } from '../../src/client-onboarding/client-onboarding-readiness.service.js';

function setup(overrides: Record<string, unknown> = {}) {
  const prisma = {
    hub: { count: vi.fn().mockResolvedValue(1) },
    user: { count: vi.fn().mockResolvedValue(1) },
    fleet: { count: vi.fn().mockResolvedValue(1) },
    clientOnboardingProgress: {
      findUnique: vi.fn().mockResolvedValue({
        steps: [
          { step: 'HUBS', status: 'COMPLETED' },
          { step: 'FLEET_MANAGERS', status: 'COMPLETED' },
          { step: 'TEAM_LEADERS', status: 'SKIPPED' },
          { step: 'FLEETS', status: 'COMPLETED' },
          { step: 'RIDERS', status: 'SKIPPED' },
        ],
      }),
    },
    client: { findUnique: vi.fn().mockResolvedValue({
      businessProfile: {}, operationsProfile: {}, billingProfile: {},
      contacts: [{ role: 'PRIMARY' }, { role: 'ACCOUNT_ADMIN' }],
      addresses: [{ type: 'REGISTERED' }, { type: 'BILLING' }],
      agreement: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date(), dataProcessingConsentAt: new Date() },
      subscriptions: [{ status: 'ACTIVE' }],
      documents: [{ documentType: 'PAN_CARD', uploadedAt: new Date(), verificationStatus: 'VERIFIED' }],
    }) },
    ...overrides,
  };
  return { prisma, service: new ClientOnboardingReadinessService(prisma as never) };
}

describe('ClientOnboardingReadinessService', () => {
  it('accepts a complete operational onboarding with optional steps skipped', async () => {
    const { service } = setup();
    await expect(service.operational('client-1')).resolves.toEqual([]);
  });

  it('reports missing operational records and incomplete required steps', async () => {
    const { service } = setup({
      hub: { count: vi.fn().mockResolvedValue(0) },
      user: { count: vi.fn().mockResolvedValue(0) },
      fleet: { count: vi.fn().mockResolvedValue(0) },
      clientOnboardingProgress: { findUnique: vi.fn().mockResolvedValue({ steps: [] }) },
    });
    const issues = await service.operational('client-1');
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'HUB_REQUIRED', 'FLEET_MANAGER_REQUIRED', 'FLEET_REQUIRED',
      'HUBS_INCOMPLETE', 'FLEET_MANAGERS_INCOMPLETE', 'FLEETS_INCOMPLETE',
    ]));
  });

  it('blocks activation when required commercial onboarding data is missing', async () => {
    const { service } = setup({
      client: { findUnique: vi.fn().mockResolvedValue({
        businessProfile: null, operationsProfile: null, billingProfile: null,
        contacts: [], addresses: [], agreement: null, subscriptions: [], documents: [],
      }) },
    });
    const issues = await service.activation('client-1');
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'BUSINESS_PROFILE_REQUIRED', 'OPERATIONS_PROFILE_REQUIRED',
      'BILLING_PROFILE_REQUIRED', 'AGREEMENT_REQUIRED', 'SUBSCRIPTION_REQUIRED',
      'PRIMARY_CONTACT_REQUIRED', 'ACCOUNT_ADMIN_REQUIRED',
      'REGISTERED_ADDRESS_REQUIRED', 'BILLING_ADDRESS_REQUIRED', 'PAN_REQUIRED',
    ]));
  });

  it('requires PAN verification before activation', async () => {
    const { service } = setup({
      client: { findUnique: vi.fn().mockResolvedValue({
        businessProfile: {}, operationsProfile: {}, billingProfile: {},
        contacts: [{ role: 'PRIMARY' }, { role: 'ACCOUNT_ADMIN' }],
        addresses: [{ type: 'REGISTERED' }, { type: 'BILLING' }],
        agreement: { termsAcceptedAt: new Date(), privacyAcceptedAt: new Date(), dataProcessingConsentAt: new Date() },
        subscriptions: [{ status: 'ACTIVE' }],
        documents: [{ documentType: 'PAN_CARD', uploadedAt: new Date(), verificationStatus: 'PENDING' }],
      }) },
    });
    expect((await service.activation('client-1')).map((issue) => issue.code)).toContain('PAN_REQUIRED');
  });
});
