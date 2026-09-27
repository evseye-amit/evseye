import { describe, expect, it, vi } from 'vitest';
import { fingerprint } from './kyc-security.js';
import { VerificationService } from './verification.service.js';

const secret = 'a'.repeat(40);
const dto = { riderId: 'rider-1', type: 'IFSC_VERIFICATION' as const, ifsc: 'HDFC0001234' };

describe('verification service isolation and idempotency', () => {
  it('returns a client-scoped existing request without calling a provider', async () => {
    const existing = { id: 'verification-1', clientId: 'client-1', riderId: 'rider-1',
      verificationType: dto.type, consentId: null,
      inputFingerprint: fingerprint(secret, 'client-1', 'rider-1', dto.type, dto.ifsc) };
    const prisma = { rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      kycVerification: { findUnique: vi.fn().mockResolvedValue(existing),
        findFirst: vi.fn().mockResolvedValue({ id: existing.id, status: 'VERIFIED' }) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]) } };
    const registry = { resolve: vi.fn() };
    const config = { get: vi.fn((key: string) => key === 'KYC_ENABLED' ? true : secret) };
    const service = new VerificationService(prisma as never, registry as never, config as never, {} as never, {} as never);
    const result = await service.start('client-1', 'same-request-key', dto);
    expect(result).toEqual({ id: existing.id, status: 'VERIFIED', auditTimeline: [], routingTimeline: [] });
    expect(prisma.kycVerification.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: existing.id, clientId: 'client-1' } }));
    expect(registry.resolve).not.toHaveBeenCalled();
  });

  it('rejects a reused idempotency key for a different identity', async () => {
    const prisma = { rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      kycVerification: { findUnique: vi.fn().mockResolvedValue({ id: 'verification-1',
        riderId: 'rider-1', verificationType: dto.type, inputFingerprint: 'different' }) } };
    const service = new VerificationService(prisma as never, { resolve: vi.fn() } as never,
      { get: vi.fn((key: string) => key === 'KYC_ENABLED' ? true : secret) } as never, {} as never, {} as never);
    await expect(service.start('client-1', 'same-request-key', dto)).rejects.toThrow('different verification');
  });

  it('does not retrieve another client verification', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new VerificationService({ kycVerification: { findFirst } } as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.get('client-a', 'verification-b')).rejects.toThrow('KYC_VERIFICATION_NOT_FOUND');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'verification-b', clientId: 'client-a' } }));
  });

  it('rejects concurrent duplicate OTP submissions before another provider call', async () => {
    const completeAadhaarOtp = vi.fn();
    const prisma = { kycVerification: { findFirst: vi.fn().mockResolvedValue({
      id: 'verification-1', verificationType: 'AADHAAR_OTP', status: 'OTP_REQUIRED',
      expiresAt: new Date(Date.now() + 60_000), attempts: [{ providerTransactionId: '123456' }],
    }) }, $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      kycVerification: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    })) };
    const registry = { pinned: vi.fn().mockResolvedValue({ config: { id: 'provider-1' },
      capability: { timeoutMs: 10000 }, provider: { completeAadhaarOtp } }) };
    const service = new VerificationService(prisma as never, registry as never, {} as never, {} as never, {} as never);
    await expect(service.completeOtp('client-a', 'verification-1', '123456')).rejects.toThrow('KYC_INVALID_STATE');
    expect(completeAadhaarOtp).not.toHaveBeenCalled();
  });

  it('never creates an accepted consent from an unaccepted request', async () => {
    const create = vi.fn();
    const prisma = { rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
      kycConsent: { create } };
    const service = new VerificationService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.consent('client-a', { riderId: 'rider-1', verificationType: 'AADHAAR_OTP',
      consentVersion: 'v1', consentTextHash: 'a'.repeat(64), purpose: 'Verify identity for rider onboarding',
      reason: 'Rider identity verification for onboarding', accepted: false, channel: 'OPERATIONS_PANEL' }))
      .rejects.toThrow('KYC_CONSENT_REQUIRED');
    expect(create).not.toHaveBeenCalled();
  });
});
