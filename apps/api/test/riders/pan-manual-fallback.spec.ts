import { describe, expect, it, vi } from 'vitest';
import { PanVerificationPolicyService } from '../../src/riders/pan-verification-policy.service.js';
import { RiderDocumentReviewService } from '../../src/riders/rider-document-review.service.js';
import { documentKycStatus, RiderKycStatusService } from '../../src/riders/rider-kyc-status.service.js';
import { PanVerificationCoordinator } from '../../src/kyc/verification/pan-verification-coordinator.service.js';

function setup({ enabled = true, clientPolicy = true, feature = true, provider = true, documentStatus = 'APPROVED', panStatus = undefined as string | undefined } = {}) {
  const prisma = {
    kycClientPolicy: { findFirst: vi.fn().mockResolvedValue({ isEnabled: clientPolicy }) },
    clientFeature: { findFirst: vi.fn().mockResolvedValue(feature ? { id: 'feature' } : null) },
    kycProviderConfig: { findFirst: vi.fn().mockResolvedValue(provider ? { id: 'provider' } : null) },
    rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider', userId: 'user' }) },
    riderKyc: { findUnique: vi.fn().mockResolvedValue(panStatus ? { status: panStatus } : null) },
    riderOnboardingDocument: { findMany: vi.fn().mockResolvedValue(documentStatus ? [{ fieldCode: 'PAN_PROOF_DOCUMENT', status: documentStatus }] : []) },
    riderOnboardingProgress: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const config = { get: (key: string) => key === 'KYC_ENABLED' ? enabled : key === 'KYC_ENVIRONMENT' ? 'TEST' : undefined };
  const policy = new PanVerificationPolicyService(prisma as never, config as never);
  const fields = [{ fieldCode: 'PAN_PROOF_DOCUMENT', isUpload: true, required: true, disabled: false }];
  const configuration = { getEffectiveConfiguration: async () => ({ onboarding: { steps: [{ fields }] } }) };
  const kyc = new RiderKycStatusService(prisma as never, configuration as never, policy);
  const review = new RiderDocumentReviewService(prisma as never, configuration as never, kyc);
  const start = vi.fn();
  const coordinator = new PanVerificationCoordinator(prisma as never, { start } as never, policy);
  return { policy, review, coordinator, prisma, fields, start };
}

describe('PAN manual fallback shared policy', () => {
  it.each([{ enabled: false }, { clientPolicy: false }, { feature: false }, { provider: false }])('accepts approved manual PAN and never starts a provider when disabled: %j', async (flags) => {
    const { review, coordinator, start, prisma } = setup(flags);
    expect(await review.allocationBlockers('pinkrides', 'rider')).toEqual([]);
    expect(await coordinator.startIfReady('pinkrides', 'user')).toMatchObject({ status: 'DISABLED' });
    expect(start).not.toHaveBeenCalled();
    expect(prisma.riderKyc.findUnique).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'REJECTED', ''])('manual mode still blocks unapproved/missing documents: %s', async (documentStatus) => {
    expect(await setup({ provider: false, documentStatus }).review.allocationBlockers('pinkrides', 'rider'))
      .toEqual([expect.objectContaining({ fieldCode: 'PAN_PROOF_DOCUMENT' })]);
  });
  it.each([undefined, 'PENDING', 'FAILED'])('enabled provider cannot fall back to manual approval: %s', async (panStatus) => {
    const { review, fields } = setup({ panStatus });
    expect(await review.allocationBlockers('pinkrides', 'rider')).toEqual([expect.objectContaining({ fieldCode: 'PAN_VERIFICATION' })]);
    expect(documentKycStatus(fields, [{ fieldCode: 'PAN_PROOF_DOCUMENT', status: 'APPROVED', reviewedAt: new Date() }],
      panStatus ? [{ type: 'PAN', status: panStatus, verifiedAt: null }] : [], true).kycStatus).not.toBe('VERIFIED');
  });
  it('accepts provider verification only when manual document checks also pass', async () => {
    expect(await setup({ panStatus: 'VERIFIED' }).review.allocationBlockers('pinkrides', 'rider')).toEqual([]);
    expect(await setup({ panStatus: 'VERIFIED', documentStatus: 'PENDING' }).review.allocationBlockers('pinkrides', 'rider'))
      .toEqual([expect.objectContaining({ fieldCode: 'PAN_PROOF_DOCUMENT' })]);
  });
  it('checks provider configuration rather than runtime health or credentials', async () => {
    const { policy, prisma } = setup();
    expect(await policy.automated('pinkrides')).toBe(true);
    expect(prisma.kycProviderConfig.findFirst).toHaveBeenCalledWith({ where: {
      isActive: true, status: 'ACTIVE', environment: 'TEST',
      capabilities: { some: { verificationType: 'PAN_VERIFICATION', isSupported: true, isEnabled: true } },
    }, select: { id: true } });
  });
});
