import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { RiderAppService } from '../../src/riders/rider-app.service.js';

const duplicate = () => new Prisma.PrismaClientKnownRequestError('Duplicate mobile', { code: 'P2002', clientVersion: '7' });
function setup(existing: unknown = null) {
  const user = { id: 'user-1', role: 'RIDER', isActive: true, deletedAt: null };
  const tx = {
    user: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn().mockResolvedValue(user) },
    riderOnboardingProgress: { upsert: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-1' }) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const configuration = { getEffectiveConfiguration: vi.fn().mockResolvedValue({ package: { id: 'package-1' }, onboarding: { steps: [{ stepId: 'step-1' }] } }) };
  return { user, tx, prisma, service: new RiderAppService(prisma as never, configuration as never, {} as never, {} as never) };
}

describe('RiderAppService.enroll', () => {
  it('creates a new rider and initializes onboarding', async () => {
    const { service, tx } = setup();
    await expect(service.enroll('company', '9876543210')).resolves.toEqual({ clientId: 'client-1', userId: 'user-1', phone: '+919876543210' });
    expect(tx.user.create).toHaveBeenCalledWith({ data: { clientId: 'client-1', mobile: '+919876543210', name: 'Pending Rider', role: 'RIDER' } });
    expect(tx.riderOnboardingProgress.upsert).toHaveBeenCalledOnce();
  });
  it.each(['+919876543210', '919876543210', '9876543210', '09876543210'])('reuses an active rider with legacy mobile %s', async (mobile) => {
    const { service, tx } = setup({ id: 'existing', role: 'RIDER', isActive: true, deletedAt: null, mobile });
    tx.user.findFirst.mockImplementation(async ({ where }) => where.clientId === 'client-1' && where.mobile.in.includes(mobile) ? { id: 'existing', role: 'RIDER', isActive: true, deletedAt: null } : null);
    await expect(service.enroll('company', '+919876543210')).resolves.toMatchObject({ userId: 'existing' });
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it.each([
    { role: 'RIDER', isActive: false, deletedAt: null },
    { role: 'RIDER', isActive: true, deletedAt: new Date() },
    { role: 'ADMIN', isActive: true, deletedAt: null },
  ])('rejects unavailable or other-role accounts without creating users', async (existing) => {
    const { service, tx } = setup({ id: 'existing', ...existing });
    await expect(service.enroll('company', '9876543210')).rejects.toMatchObject({ status: 409 });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.riderOnboardingProgress.upsert).not.toHaveBeenCalled();
  });
  it('reuses the winning account after a concurrent creation conflict', async () => {
    const { service, tx, user, prisma } = setup();
    tx.user.create.mockRejectedValueOnce(duplicate());
    tx.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    await expect(service.enroll('company', '9876543210')).resolves.toMatchObject({ userId: user.id });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.user.create).toHaveBeenCalledOnce();
  });
  it('returns a conflict when the unique collision persists', async () => {
    const { service, tx, prisma } = setup();
    tx.user.create.mockRejectedValue(duplicate());
    await expect(service.enroll('company', '9876543210')).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
  it('does not retry unrelated database failures', async () => {
    const { service, tx, prisma } = setup();
    const error = new Error('Connection lost');
    tx.user.create.mockRejectedValue(error);
    await expect(service.enroll('company', '9876543210')).rejects.toBe(error);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
