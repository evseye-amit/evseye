import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  documentKycStatus,
  RiderKycStatusService,
} from './rider-kyc-status.service.js';

const fields = [
  { fieldCode: 'AADHAAR', isUpload: true, required: true, disabled: false },
  { fieldCode: 'PAN', isUpload: true, required: false, disabled: false },
];
const at = new Date('2026-10-18T10:00:00Z');
const approved = { fieldCode: 'AADHAAR', status: 'APPROVED', reviewedAt: at };

describe('overall rider KYC from current onboarding documents', () => {
  it('supports legacy workspaces without a published onboarding workflow', async () => {
    const service = new RiderKycStatusService({} as never, {
      getEffectiveConfiguration: vi.fn().mockRejectedValue(new NotFoundException('Published workflow is unavailable for this workspace.')),
    } as never);
    expect(await service.fields('client-1')).toEqual([]);
  });
  it('does not hide configuration or database failures as a legacy workspace', async () => {
    const service = new RiderKycStatusService({} as never, {
      getEffectiveConfiguration: vi.fn().mockRejectedValue(new Error('Database unavailable')),
    } as never);
    await expect(service.fields('client-1')).rejects.toThrow('Database unavailable');
  });
  it('verifies when required documents are approved without requiring unsubmitted optional documents', () => {
    expect(documentKycStatus(fields, [approved])).toEqual({
      kycStatus: 'VERIFIED',
      kycVerifiedAt: at,
    });
  });
  it('does not allow a provider result or optional document to bypass a missing required document', () => {
    expect(
      documentKycStatus(
        fields,
        [{ ...approved, fieldCode: 'PAN' }],
        [{ status: 'VERIFIED', verifiedAt: at }],
      ).kycStatus,
    ).toBe('PENDING');
  });
  it.each(['PENDING', 'REJECTED'] as const)(
    'blocks verification for submitted optional documents in %s state',
    (status) => {
      expect(
        documentKycStatus(fields, [
          approved,
          { fieldCode: 'PAN', status, reviewedAt: null },
        ]),
      ).toEqual({
        kycStatus: status === 'REJECTED' ? 'FAILED' : 'PENDING',
        kycVerifiedAt: null,
      });
    },
  );
  it('ignores disabled fields and fields excluded from the active configuration', () => {
    expect(
      documentKycStatus(
        [
          ...fields,
          {
            fieldCode: 'DISABLED',
            isUpload: true,
            required: true,
            disabled: true,
          },
        ],
        [
          approved,
          { fieldCode: 'OLD_DOCUMENT', status: 'REJECTED', reviewedAt: at },
        ],
      ).kycStatus,
    ).toBe('VERIFIED');
  });
  it('clears verification when the current document is replaced', () => {
    expect(
      documentKycStatus(fields, [
        { ...approved, status: 'PENDING', reviewedAt: null },
      ]),
    ).toEqual({ kycStatus: 'PENDING', kycVerifiedAt: null });
  });
  it('does not verify a rider just because there are no configured documents', () => {
    expect(documentKycStatus([], []).kycStatus).toBe('NOT_STARTED');
  });
  it('retains legacy provider-only verification for clients without document review', () => {
    expect(
      documentKycStatus([], [], [{ status: 'VERIFIED', verifiedAt: at }]),
    ).toEqual({ kycStatus: 'VERIFIED', kycVerifiedAt: at });
    expect(
      documentKycStatus(
        [],
        [],
        [
          { status: 'VERIFIED', verifiedAt: at },
          { status: 'PENDING', verifiedAt: null },
        ],
      ).kycStatus,
    ).toBe('PENDING');
  });
  it('uses the final document review time as the verification timestamp', () => {
    const later = new Date(at.getTime() + 1000);
    expect(
      documentKycStatus(fields, [
        approved,
        { ...approved, fieldCode: 'PAN', reviewedAt: later },
      ]).kycVerifiedAt,
    ).toEqual(later);
  });
  it('counts each rider once using documents, including historical approvals without a saved KYC status', async () => {
    const prisma = {
      rider: {
        findMany: vi.fn().mockResolvedValue([
          {
            user: { riderOnboardingDocuments: [approved] },
            kycs: [{ status: 'VERIFIED' }, { status: 'VERIFIED' }],
          },
          { user: { riderOnboardingDocuments: [] }, kycs: [] },
          {
            user: {
              riderOnboardingDocuments: [{ ...approved, status: 'REJECTED' }],
            },
            kycs: [],
          },
        ]),
      },
    };
    const configuration = {
      getEffectiveConfiguration: vi
        .fn()
        .mockResolvedValue({ onboarding: { steps: [{ fields }] } }),
    };
    const service = new RiderKycStatusService(
      prisma as never,
      configuration as never,
    );
    expect(await service.summary('client-1')).toEqual({
      VERIFIED: 1,
      PENDING: 1,
      FAILED: 1,
      NOT_STARTED: 0,
    });
    expect(prisma.rider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1', deletedAt: null },
      }),
    );
  });
});
