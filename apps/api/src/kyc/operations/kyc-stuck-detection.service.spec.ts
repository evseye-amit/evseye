import { describe, expect, it } from 'vitest';
import { KycStuckDetectionService } from './kyc-stuck-detection.service.js';

const thresholds: Record<string, number> = {
  KYC_OPS_STUCK_PROCESSING_MINUTES: 10,
  KYC_OPS_STUCK_PROVIDER_MINUTES: 5,
  KYC_OPS_ACTION_REQUIRED_MINUTES: 60,
  KYC_OPS_REVIEW_SLA_MINUTES: 240,
};
const detector = new KycStuckDetectionService({ get: (key: string) => thresholds[key] } as never);
const now = new Date('2026-09-27T12:00:00.000Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe('KYC operational classifications', () => {
  it('does not mark recent processing or terminal verification stuck', () => {
    expect(detector.verificationFlags({ status: 'PROCESSING', updatedAt: ago(9), expiresAt: null }, now)).toEqual([]);
    expect(detector.verificationFlags({ status: 'VERIFIED', updatedAt: ago(999), expiresAt: null }, now)).toEqual([]);
  });
  it('marks only overdue processing and provider attempts', () => {
    expect(detector.verificationFlags({ status: 'PROCESSING', updatedAt: ago(11), expiresAt: null,
      attempts: [{ requestStartedAt: ago(6), responseReceivedAt: null }] }, now)).toEqual(['STUCK', 'PROVIDER_PENDING']);
  });
  it('keeps action deadlines distinct from technical failure', () => {
    expect(detector.verificationFlags({ status: 'OTP_REQUIRED', updatedAt: ago(30), expiresAt: new Date(now.getTime() + 1000) }, now)).toEqual([]);
    expect(detector.verificationFlags({ status: 'OTP_REQUIRED', updatedAt: ago(30), expiresAt: ago(1) }, now)).toEqual(['ACTION_REQUIRED_EXPIRED']);
  });
  it('flags overdue manual review while keeping completed workflows clear', () => {
    expect(detector.workflowFlags({ status: 'MANUAL_REVIEW', updatedAt: ago(241), reviewDueAt: null, expiresAt: null }, now)).toEqual(['MANUAL_REVIEW_OVERDUE']);
    expect(detector.workflowFlags({ status: 'VERIFIED', updatedAt: ago(241), reviewDueAt: ago(1), expiresAt: null }, now)).toEqual([]);
  });
});
