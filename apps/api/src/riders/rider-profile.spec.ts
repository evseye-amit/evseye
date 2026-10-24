import { describe, expect, it, vi } from 'vitest';
import { RiderAppService } from './rider-app.service.js';
import { RiderAppController } from './rider-app.controller.js';

function fixture(completed = false) {
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'user', name: 'Pending Rider', mobile: '+919000000001' }) },
    rider: { findFirst: vi.fn().mockResolvedValue(null) },
    riderOnboardingProgress: { findFirst: vi.fn().mockResolvedValue({ values: { CUSTOM_NAME: 'Draft Name', ACCOUNT: '0012345678', SECRET: 'hidden' }, completedAt: completed ? new Date() : null }) },
  };
  const kyc = {
    fields: vi.fn().mockResolvedValue([{ fieldCode: 'CUSTOM_NAME', storageKey: 'name' }, { fieldCode: 'ACCOUNT', storageKey: 'metadata.bankAccountNumber' }]),
    forUser: vi.fn().mockResolvedValue({ kycStatus: 'PENDING', kycVerifiedAt: null }),
  };
  const service = new RiderAppService(prisma as never, {} as never, {} as never, kyc as never);
  return { service, prisma, kyc };
}

describe('Rider profile', () => {
  it('returns incomplete onboarding using configured keys, with null optional fields and no raw metadata', async () => {
    const { service, prisma } = fixture();
    const result = await service.profile('client', 'user');
    expect(result).toMatchObject({ riderId: null, name: 'Draft Name', mobile: '+919000000001', city: null, status: 'ONBOARDING', bankDetails: { bankAccountNumber: '0012345678', ifscCode: null }, onboarding: { completed: false }, kycStatus: 'PENDING' });
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(prisma.rider.findFirst).toHaveBeenCalledWith({ where: { clientId: 'client', userId: 'user', deletedAt: null } });
    expect(prisma.riderOnboardingProgress.findFirst).toHaveBeenCalledWith({ where: { clientId: 'client', userId: 'user' } });
  });
  it('uses saved Rider fields ahead of draft values and keeps bank account numbers as strings', async () => {
    const { service, prisma } = fixture();
    prisma.rider.findFirst.mockResolvedValue({ id: 'rider', name: 'Saved Name', status: 'ACTIVE', metadata: { bankAccountNumber: '0099999999', privateValue: 'hidden' } } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ riderId: 'rider', name: 'Saved Name', bankDetails: { bankAccountNumber: '0099999999' } });
  });
  it('does not resurrect stale completed onboarding values', async () => {
    const { service } = fixture(true);
    expect(await service.profile('client', 'user')).toMatchObject({ name: null, bankDetails: { bankAccountNumber: null } });
  });
  it('handles an account without onboarding progress', async () => {
    const { service, prisma } = fixture();
    prisma.riderOnboardingProgress.findFirst.mockResolvedValue(null);
    expect(await service.profile('client', 'user')).toMatchObject({ name: null, onboarding: { completed: false, completedAt: null } });
  });
  it('rejects unavailable or foreign-client accounts before reading profile data', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.profile('other-client', 'user')).rejects.toThrow('Rider account not found');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user', clientId: 'other-client', role: 'RIDER', isActive: true, deletedAt: null } }));
    expect(prisma.rider.findFirst).not.toHaveBeenCalled();
  });
  it('controller uses authenticated identity and requires a client', async () => {
    const service = { profile: vi.fn().mockResolvedValue({ name: 'Rider' }) };
    const controller = new RiderAppController(service as never);
    await expect(controller.profile({ id: 'user', clientId: 'client', roles: ['RIDER'] })).resolves.toEqual({ data: { name: 'Rider' } });
    expect(service.profile).toHaveBeenCalledWith('client', 'user');
    await expect(controller.profile({ id: 'user', clientId: null, roles: ['RIDER'] })).rejects.toThrow('not associated');
  });
});
