import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AllocationsService } from '../../src/allocations/allocations.service.js';
import { AllocationsController } from '../../src/allocations/allocations.controller.js';
import { CancelAllocationDto } from '../../src/allocations/dto/cancel-allocation.dto.js';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';

function setup(overrides: Record<string, unknown> = {}) {
  const allocation = { id: 'a', fleetId: 'f', riderId: 'r', status: 'INSPECTION_PENDING', allocatedAt: null, commercialOfferId: null, rentalAgreementId: null, mobileDeployment: null, ...overrides };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    allocation: { findFirst: vi.fn().mockResolvedValue(allocation), update: vi.fn() },
    fleet: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    vehicleExchangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn() },
    deploymentPaymentCapture: { count: vi.fn().mockResolvedValue(0) },
    deploymentPayment: { update: vi.fn() },
    riderCommercialOffer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    riderRentalAgreement: { findFirst: vi.fn().mockResolvedValue({ status: 'PENDING_ACTIVATION', activatedAt: null }), update: vi.fn() },
    riderDeposit: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
    paymentCollectionRequest: { count: vi.fn().mockResolvedValue(0) },
    riderRentalAgreementStatusHistory: { create: vi.fn() },
    riderAgreementCommercialVersion: { updateMany: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
  return { tx, service: new AllocationsService(prisma as never, {} as never, { enqueue: vi.fn().mockResolvedValue(undefined) } as never) };
}
describe('Allocation cancellation', () => {
  it.each(['INITIATED', 'INSPECTION_PENDING', 'OTP_PENDING'])('releases %s and records the reason without changing readiness approvals', async status => {
    const { service, tx } = setup({ status });
    await expect(service.cancel('client', 'a', 'admin', '  Rider changed plans  ')).resolves.toMatchObject({ status: 'CANCELLED', alreadyCancelled: false });
    expect(tx.allocation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a', clientId: 'client' } }));
    expect(tx.fleet.updateMany).toHaveBeenCalledWith({ where: {
      id: 'f', clientId: 'client', status: 'RESERVED', deletedAt: null,
      allocations: { none: { id: { not: 'a' }, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
    }, data: { status: 'AVAILABLE' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 'admin', clientId: 'client', action: 'ALLOCATION_CANCELLED', newData: expect.objectContaining({ reason: 'Rider changed plans' }) }) });
  });
  it('does not release a potentially reallocated fleet on a retry', async () => {
    const { service, tx } = setup({ status: 'CANCELLED' });
    await expect(service.cancel('client', 'a', 'admin', 'Retry request')).resolves.toMatchObject({ alreadyCancelled: true });
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['ACTIVE', 'COMPLETED', 'DEALLOCATION_INITIATED'])('rejects %s', async status => {
    const { service, tx } = setup({ status });
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('Only pending');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ allocatedAt: new Date() }, { mobileDeployment: { status: 'PAYMENT_PAID', payment: { status: 'PAID' } } }, { mobileDeployment: { status: 'DEPLOYED' } }])('rejects handover or commercial obligations %j', async overrides => {
    const { service, tx } = setup(overrides);
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow();
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'REJECTED', 'FAILED'])('cancels an unpaid %s request and pending agreement', async status => {
    const { service, tx } = setup({ commercialOfferId: 'offer', rentalAgreementId: 'agreement', mobileDeployment: {
      status: 'PAYMENT_PENDING', paymentPaidAt: null, payment: { id: 'payment', status, paidAt: null },
    } });
    await expect(service.cancel('client', 'a', 'admin', 'Rider does not want to pay')).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(tx.deploymentPayment.update).toHaveBeenCalledWith({ where: { id: 'payment' }, data: { status: 'CANCELLED' } });
    expect(tx.riderRentalAgreement.update).toHaveBeenCalledWith({ where: { id: 'agreement' }, data: { status: 'CANCELLED', updatedById: 'admin' } });
    expect(tx.riderRentalAgreementStatusHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousStatus: 'PENDING_ACTIVATION', newStatus: 'CANCELLED', reason: 'Rider does not want to pay' }) });
    expect(tx.riderDeposit.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CLOSED', updatedById: 'admin' } }));
  });
  it('cancels an unaccepted offer along with the reservation', async () => {
    const { service, tx } = setup({ commercialOfferId: 'offer' });
    await service.cancel('client', 'a', 'admin', 'Rider declined');
    expect(tx.riderCommercialOffer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED', cancellationReason: 'Rider declined' }) }));
  });
  it.each(['SUBMITTED', 'PAID'])('requires payment review for %s', async status => {
    const { service, tx } = setup({ mobileDeployment: { status: 'PAYMENT_PENDING', payment: { id: 'p', status } } });
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('payment');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('blocks a recorded gateway capture even if the payment still appears pending', async () => {
    const { service, tx } = setup({ mobileDeployment: { status: 'PAYMENT_PENDING', payment: { id: 'p', status: 'PENDING' } } });
    tx.deploymentPaymentCapture.count.mockResolvedValue(1);
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('gateway payment');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('preserves funded deposits and the reservation for reconciliation', async () => {
    const { service, tx } = setup({ rentalAgreementId: 'agreement' });
    tx.riderDeposit.count.mockResolvedValue(1);
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('funded deposit');
    expect(tx.riderDeposit.updateMany).not.toHaveBeenCalled();
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('does not cancel an already activated rental agreement', async () => {
    const { service, tx } = setup({ rentalAgreementId: 'agreement' });
    tx.riderRentalAgreement.findFirst.mockResolvedValue({ status: 'ACTIVE', activatedAt: new Date() } as never);
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('already active');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an allocation outside the client scope', async () => {
    const { service, tx } = setup(); tx.allocation.findFirst.mockResolvedValue(null as never);
    await expect(service.cancel('other-client', 'a', 'admin', 'Reason')).rejects.toThrow('Allocation not found');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('rejects exchange reservations', async () => {
    const { service, tx } = setup(); tx.vehicleExchangeRequest.findFirst.mockResolvedValue({ id: 'exchange' } as never);
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('vehicle exchange');
    expect(tx.fleet.updateMany).not.toHaveBeenCalled();
  });
  it('does not cancel or audit when the fleet reservation has changed', async () => {
    const { service, tx } = setup(); tx.fleet.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('client', 'a', 'admin', 'Reason')).rejects.toThrow('reservation changed');
    expect(tx.allocation.update).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('restricts the endpoint to client admins', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AllocationsController.prototype.cancel)).toEqual(['CLIENT_ADMIN']);
  });
  it.each([' ', 'ab', 'x'.repeat(1001), null, 42])('rejects invalid reasons', async reason => {
    expect(await validate(plainToInstance(CancelAllocationDto, { reason }))).not.toHaveLength(0);
  });
});

describe('Cancelled deployment continuation', () => {
  it('blocks a stale payment request inside the allocation lock', async () => {
    const { DeploymentCommercialService } = await import('../../src/allocations/deployment-commercial.service.js');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      allocation: { findFirstOrThrow: vi.fn().mockResolvedValue({ status: 'CANCELLED', mobileDeployment: { status: 'FLEET_REQUESTED' } }) },
      deploymentPayment: { create: vi.fn() },
    };
    const db = { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
    const service = new DeploymentCommercialService(db as never, {} as never, {} as never, {} as never);
    await expect(service.requestPayment('client', 'a')).rejects.toThrow('cancelled');
    expect(tx.deploymentPayment.create).not.toHaveBeenCalled();
  });

  it('rejects a stale manual verification after cancellation', async () => {
    const { DeploymentCommercialService } = await import('../../src/allocations/deployment-commercial.service.js');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      allocation: { findFirstOrThrow: vi.fn().mockResolvedValue({ status: 'CANCELLED', mobileDeployment: { status: 'PAYMENT_PENDING', payment: { status: 'CANCELLED' } } }) },
    };
    const db = { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
    const service = new DeploymentCommercialService(db as never, {} as never, {} as never, {} as never);
    await expect(service.verifyPayment('client', 'admin', 'a')).rejects.toThrow('cancelled');
  });

  it('rejects a stale payment reference after cancellation', async () => {
    const { MobileDeploymentService } = await import('../../src/allocations/mobile-deployment.service.js');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      allocation: { findFirst: vi.fn().mockResolvedValue({ status: 'CANCELLED' }) },
      deploymentPayment: { update: vi.fn() },
    };
    const db = {
      rider: { findFirst: vi.fn().mockResolvedValue({ id: 'r' }) },
      allocation: { findFirst: vi.fn().mockResolvedValue({ id: 'a' }) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new MobileDeploymentService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.submitPaymentReference('client', 'rider-user', 'a', 'MANUAL', 'reference')).rejects.toThrow('cancelled');
    expect(tx.deploymentPayment.update).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'INSPECTION_PENDING'])('checks current allocation when requesting fleet: %s', async status => {
    const { MobileDeploymentService } = await import('../../src/allocations/mobile-deployment.service.js');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      allocation: { findFirst: vi.fn().mockResolvedValue({ status, mobileDeployment: { id: 'w', status: 'RIDER_WAITING' } }) },
      mobileDeploymentWorkflow: { update: vi.fn().mockResolvedValue({ status: 'FLEET_REQUESTED' }) },
    };
    const db = {
      userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'h' }]) },
      allocation: { findFirst: vi.fn().mockResolvedValue({ id: 'a' }) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new MobileDeploymentService(db as never, {} as never, {} as never, {} as never, {} as never, { enqueue: vi.fn().mockResolvedValue(undefined) } as never);
    const result = service.requestFleet('client', 'manager', 'a');
    if (status === 'CANCELLED') {
      await expect(result).rejects.toThrow('cancelled');
      expect(tx.mobileDeploymentWorkflow.update).not.toHaveBeenCalled();
    } else await expect(result).resolves.toEqual({ status: 'FLEET_REQUESTED' });
  });
});
