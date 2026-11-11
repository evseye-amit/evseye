import { profileBirthDate } from '../../src/riders/rider-profile-values.js';
import { describe, expect, it, vi } from 'vitest';
import { RiderAppService } from '../../src/riders/rider-app.service.js';
import { RiderAppController } from '../../src/riders/rider-app.controller.js';

function fixture(completed = false) {
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'user', name: 'Pending Rider', mobile: '+919000000001' }) },
    riderOnboardingDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    rider: { findFirst: vi.fn().mockResolvedValue(null) },
    riderOnboardingProgress: { findFirst: vi.fn().mockResolvedValue({ values: { CUSTOM_NAME: 'Draft Name', ACCOUNT: '0012345678', SECRET: 'hidden' }, completedAt: completed ? new Date() : null }) },
  };
  const kyc = {
    fields: vi.fn().mockResolvedValue([{ fieldCode: 'CUSTOM_NAME', storageKey: 'name' }, { fieldCode: 'ACCOUNT', storageKey: 'metadata.bankAccountNumber' }]),
    forUser: vi.fn().mockResolvedValue({ kycStatus: 'PENDING', kycVerifiedAt: null }),
  };
  const media = { downloadUrl: vi.fn().mockResolvedValue({ url: 'https://storage.example/signed-profile' }) };
  const service = new RiderAppService(prisma as never, {} as never, media as never, kyc as never);
  return { service, prisma, kyc, media };
}

describe('Rider profile', () => {
  it('returns incomplete onboarding using configured keys, with null optional fields and no raw metadata', async () => {
    const { service, prisma } = fixture();
    const result = await service.profile('client', 'user');
    expect(result).toMatchObject({ riderId: null, name: 'Draft Name', mobile: '+919000000001', addresses: { current: { city: null } }, status: 'ONBOARDING', bankDetails: { bankAccountNumber: '0012345678', ifscCode: null }, onboarding: { completed: false }, kycStatus: 'PENDING' });
    expect(JSON.stringify(result)).not.toContain('hidden');
    for (const key of ['address', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode']) expect(result).not.toHaveProperty(key);
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


describe('Rider profile photos, addresses and birth date', () => {
  it('returns the saved birth date as a date only and structured addresses without leaking metadata', async () => {
    const { service, prisma } = fixture(true);
    prisma.rider.findFirst.mockResolvedValue({ dateOfBirth: new Date('2000-01-02T00:00:00Z'), address: 'Current full address', city: 'Delhi', metadata: { permanentAddress: 'Permanent full address', permanentAddressCity: 'Jaipur', permanentAddressPincode: '302001', secret: 'hidden' } } as never);
    const result = await service.profile('client', 'user');
    expect(result).toMatchObject({ dateOfBirth: '2000-01-02', profilePhotoUrl: null, addresses: { current: { address: 'Current full address', city: 'Delhi' }, permanent: { address: 'Permanent full address', city: 'Jaipur', postalCode: '302001' }, sameAsCurrentAddress: false } });
    expect(JSON.stringify(result)).not.toContain('hidden');
    for (const key of ['address', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode']) expect(result).not.toHaveProperty(key);
  });
  it('uses configured draft address/date fields and copies current address only when explicitly selected', async () => {
    const { service, prisma, kyc } = fixture();
    kyc.fields.mockResolvedValue([{ fieldCode: 'MY_DOB', storageKey: 'dateOfBirth' }, { fieldCode: 'MY_ADDRESS', storageKey: 'metadata.currentAddress' }, { fieldCode: 'SAME', storageKey: 'metadata.sameAsCurrentAddress' }]);
    prisma.riderOnboardingProgress.findFirst.mockResolvedValue({ values: { MY_DOB: '2001-05-06', MY_ADDRESS: 'Draft address', SAME: true }, completedAt: null } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ dateOfBirth: '2001-05-06', addresses: { current: { address: 'Draft address' }, permanent: { address: 'Draft address' }, sameAsCurrentAddress: true } });
  });
  it('signs only a current completed profile upload belonging to the authenticated Rider', async () => {
    const { service, prisma, media } = fixture();
    prisma.riderOnboardingDocument.findFirst.mockResolvedValue({ photoId: 'profile-photo' } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ profilePhotoUrl: 'https://storage.example/signed-profile' });
    expect(prisma.riderOnboardingDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientId: 'client', userId: 'user', supersededAt: null, status: { in: ['PENDING', 'APPROVED'] }, feature: { code: 'UPLOAD_PROFILE_PHOTO' }, photo: expect.objectContaining({ clientId: 'client', status: 'COMPLETE' }) }) }));
    expect(media.downloadUrl).toHaveBeenCalledWith('client', 'profile-photo');
  });
  it('returns null when no usable photo exists and does not copy addresses for false', async () => {
    const { service, prisma, media } = fixture(true);
    prisma.rider.findFirst.mockResolvedValue({ metadata: { currentAddress: 'Current', sameAsCurrentAddress: 'false' } } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ profilePhotoUrl: null, dateOfBirth: null, addresses: { permanent: { address: null }, sameAsCurrentAddress: false } });
    expect(media.downloadUrl).not.toHaveBeenCalled();
  });
});


describe('historical completed onboarding profile recovery', () => {
  it('recovers DOB and addresses from completed onboarding even when configuration has changed', async () => {
    const { service, prisma } = fixture(true);
    prisma.rider.findFirst.mockResolvedValue({ dateOfBirth: null, address: null, metadata: {} } as never);
    prisma.riderOnboardingProgress.findFirst.mockResolvedValue({ completedAt: new Date(), values: { DATE_OF_BIRTH: '22/01/2002', CURRENT_ADDRESS: 'Saved onboarding address', CURRENT_ADDRESS_CITY: 'Delhi', CURRENT_ADDRESS_PINCODE: '110001', PERMANENT_ADDRESS: 'Permanent address' } } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ dateOfBirth: '2002-01-22', addresses: { current: { address: 'Saved onboarding address', postalCode: '110001' }, permanent: { address: 'Permanent address' } } });
  });
  it('keeps saved Rider data ahead of historical onboarding data', async () => {
    const { service, prisma } = fixture(true);
    prisma.rider.findFirst.mockResolvedValue({ dateOfBirth: new Date('1999-01-02'), address: 'Updated address' } as never);
    prisma.riderOnboardingProgress.findFirst.mockResolvedValue({ completedAt: new Date(), values: { DATE_OF_BIRTH: '22/01/2002', ADDRESS: 'Old address' } } as never);
    expect(await service.profile('client', 'user')).toMatchObject({ dateOfBirth: '1999-01-02', addresses: { current: { address: 'Updated address' } } });
  });
  it.each(['2002-02-31', '31/02/2002', 'not a date', '', null])('rejects invalid birth date %j', value => expect(profileBirthDate(value)).toBeNull());
  it('accepts both supported date formats', () => {
    expect(profileBirthDate('29/02/2000')).toBe('2000-02-29');
    expect(profileBirthDate('2000-02-29')).toBe('2000-02-29');
  });
});
