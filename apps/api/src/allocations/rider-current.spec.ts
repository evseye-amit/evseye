import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { MobileDeploymentService } from './mobile-deployment.service.js';

function setup() {
  const allocation = { id: 'allocation-1', status: 'ACTIVE', rentalAgreementId: 'agreement-1', fleet: { id: 'fleet-1' }, mobileDeployment: { id: 'workflow-1', status: 'DEPLOYED' } };
  const prisma = {
    rider: { findFirst: vi.fn().mockResolvedValue({ id: 'rider-1' }) },
    allocation: { findFirst: vi.fn().mockResolvedValue(allocation) },
    inspection: { findFirst: vi.fn().mockResolvedValue({ id: 'inspection-1' }) },
    photo: { findFirst: vi.fn().mockResolvedValue({ id: 'front-1' }) },
    deploymentPayment: { findUnique: vi.fn().mockResolvedValue(null) },
    riderInvoice: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    walletTransaction: { findFirst: vi.fn().mockResolvedValue({ id: 'earning-1', amount: new Prisma.Decimal('50'), currency: 'INR', transactionType: 'REWARD' }) },
  };
  const wallet = {
    riderWallet: vi.fn().mockResolvedValue({ id: 'wallet-1', status: 'ACTIVE' }),
    balance: vi.fn().mockResolvedValue({ currency: 'INR', totalBalance: '150.00', availableBalance: '100.00', accounts: [{ accountId: 'internal' }] }),
  };
  const media = { downloadUrl: vi.fn().mockResolvedValue({ url: 'https://storage.test/front-signed' }) };
  const service = new MobileDeploymentService(prisma as never, {} as never, media as never, {} as never, {} as never);
  Object.assign(service, { wallet, config: { get: vi.fn().mockReturnValue(300) } });
  return { service, prisma, allocation, wallet, media };
}

describe('Rider current deployment and Home', () => {
  it('includes the front inspection image and wallet on active Home', async () => {
    const { service, prisma, media } = setup();
    const result = await service.riderCurrent('client-1', 'user-1');
    expect(result).toMatchObject({ screen: 'HOME', allocation: { fleet: { id: 'fleet-1', frontPhoto: { id: 'front-1', url: 'https://storage.test/front-signed', expiresAt: expect.any(String) } } }, wallet: { availableBalance: '100.00' }, lastEarnings: { amount: '50.00' } });
    expect('wallet' in result ? result.wallet : undefined).not.toHaveProperty('accounts');
    expect(prisma.inspection.findFirst).toHaveBeenCalledWith({ where: { clientId: 'client-1', allocationId: 'allocation-1', type: 'PRE_ALLOCATION' }, select: { id: true } });
    expect(prisma.photo.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-1', entityId: 'inspection-1', photoType: 'FRONT', status: 'COMPLETE' } }));
    expect(media.downloadUrl).toHaveBeenCalledWith('client-1', 'front-1');
  });
  it('shows Home after return without old scooter, workflow or payment details', async () => {
    const { service, prisma } = setup();
    prisma.allocation.findFirst.mockResolvedValueOnce(null as never).mockResolvedValueOnce({ id: 'returned-allocation' } as never);
    expect(await service.riderCurrent('client-1', 'user-1')).toMatchObject({ screen: 'HOME', allocation: null, workflow: null, payment: null, commercial: null, wallet: { totalBalance: '150.00' }, lastEarnings: { id: 'earning-1', amount: '50.00' } });
    expect(prisma.allocation.findFirst.mock.calls[0][0]).toMatchObject({ where: { clientId: 'client-1', riderId: 'rider-1', status: { notIn: ['COMPLETED', 'CANCELLED'] } } });
    expect(prisma.photo.findFirst).not.toHaveBeenCalled();
    expect(prisma.deploymentPayment.findUnique).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-1', walletId: 'wallet-1', status: 'POSTED', transactionType: { in: ['REWARD', 'REFERRAL_REWARD', 'SELF_SUBMISSION_REWARD'] } } }));
  });
  it('keeps a new rider waiting, including a cancellation before handover', async () => {
    const { service, prisma, wallet } = setup();
    prisma.allocation.findFirst.mockResolvedValue(null as never);
    expect(await service.riderCurrent('client-1', 'user-1')).toMatchObject({ screen: 'WAITING', allocation: null, wallet: null, lastEarnings: null });
    expect(prisma.allocation.findFirst.mock.calls[1][0]).toMatchObject({ where: { OR: [{ status: 'COMPLETED' }, { allocatedAt: { not: null } }] } });
    expect(wallet.riderWallet).not.toHaveBeenCalled();
  });
  it('preserves onboarding before the Rider profile exists', async () => {
    const { service, prisma } = setup();
    prisma.rider.findFirst.mockResolvedValue(null as never);
    expect(await service.riderCurrent('client-1', 'user-1')).toEqual({ screen: 'ONBOARDING' });
  });
  it.each(['PAYMENT_PENDING', 'PDI_PENDING_RIDER'])('keeps new deployment routing after a previous return: %s', async (status) => {
    const { service, allocation, wallet } = setup();
    allocation.mobileDeployment.status = status;
    expect(await service.riderCurrent('client-1', 'user-1')).toMatchObject({ screen: status === 'PAYMENT_PENDING' ? 'PAYMENT' : 'PDI', allocation: { id: 'allocation-1' } });
    expect(wallet.riderWallet).not.toHaveBeenCalled();
  });
  it('returns a null photo without completed FRONT evidence and null earnings without a posted reward', async () => {
    const { service, prisma, media } = setup();
    prisma.photo.findFirst.mockResolvedValue(null as never);
    prisma.walletTransaction.findFirst.mockResolvedValue(null as never);
    expect(await service.riderCurrent('client-1', 'user-1')).toMatchObject({ allocation: { fleet: { frontPhoto: null } }, lastEarnings: null });
    expect(media.downloadUrl).not.toHaveBeenCalled();
  });
  it('hides optional PDI items from both Rider response paths without altering the source', async () => {
    const { service, allocation } = setup();
    const checks = [{ code: 'BRAKES', label: 'Brakes', mandatory: true }, { code: 'ACCESSORY', label: 'Accessory', mandatory: false }];
    Object.assign(allocation.mobileDeployment, { status: 'PDI_PENDING_RIDER', pdiChecklist: checks });
    const result = await service.riderCurrent('client-1', 'user-1');
    expect(result).toMatchObject({ workflow: { pdiChecklist: [checks[0]] }, allocation: { mobileDeployment: { pdiChecklist: [checks[0]] } } });
    expect(JSON.stringify(result)).not.toContain('ACCESSORY');
    expect(allocation.mobileDeployment).toMatchObject({ pdiChecklist: checks });
  });

});
