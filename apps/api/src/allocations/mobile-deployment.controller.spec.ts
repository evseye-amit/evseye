import { describe, expect, it, vi } from 'vitest';
import { MobileDeploymentController } from './mobile-deployment.controller.js';

describe('MobileDeploymentController', () => {
  it('returns translated labels keyed by stable mobile workflow codes', () => {
    const controller = new MobileDeploymentController({} as never, {} as never);
    const result = controller.localization('te-IN');
    expect(result.data).toMatchObject({
      locale: 'te',
      screens: { PAYMENT: 'చెల్లింపు' },
      deploymentStatuses: { PAYMENT_PENDING: 'చెల్లింపు పెండింగ్‌లో ఉంది' },
      fleetStatuses: { AVAILABLE: 'అందుబాటులో ఉంది' },
    });
  });

  it('returns resolved Fleet Manager requests inside the data envelope', async () => {
    const requests = [{ id: 'allocation-1' }];
    const deployments = { fleetRequests: vi.fn().mockResolvedValue(requests) };
    const clients = { requireClientId: vi.fn().mockReturnValue('client-1') };
    const controller = new MobileDeploymentController(deployments as never, clients as never);

    await expect(controller.requests({ id: 'manager-1' } as never)).resolves.toEqual({ data: requests });
    expect(deployments.fleetRequests).toHaveBeenCalledWith('client-1', 'manager-1');
  });

  it('propagates a service error instead of leaving an unhandled nested Promise', async () => {
    const error = new Error('Database unavailable');
    const deployments = { fleetRequests: vi.fn().mockRejectedValue(error) };
    const clients = { requireClientId: vi.fn().mockReturnValue('client-1') };
    const controller = new MobileDeploymentController(deployments as never, clients as never);

    await expect(controller.requests({ id: 'manager-1' } as never)).rejects.toBe(error);
  });

  it('passes the authoritative client partner id while retaining the legacy name argument', async () => {
    const deployments = { submitPdi: vi.fn().mockResolvedValue({ status: 'PDI_PENDING_RIDER' }) };
    const clients = { requireClientId: vi.fn().mockReturnValue('client-1') };
    const controller = new MobileDeploymentController(deployments as never, clients as never);

    await expect(controller.pdi(
      { id: 'manager-1' } as never,
      'allocation-1',
      { clientWorkPartnerId: 'partner-1', workPartnerName: 'Legacy', checklist: [] } as never,
    )).resolves.toEqual({ data: { status: 'PDI_PENDING_RIDER' } });
    expect(deployments.submitPdi).toHaveBeenCalledWith(
      'client-1',
      'manager-1',
      'allocation-1',
      'Legacy',
      [],
      'partner-1',
    );
  });
});
