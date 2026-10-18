import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { ClientWorkPartnersController } from './client-work-partners.controller.js';
import { PlatformWorkPartnersController } from './platform-work-partners.controller.js';

describe('work partner controllers', () => {
  it('keeps platform writes behind the super-admin role and returns data envelopes', async () => {
    const service = { createMaster: vi.fn().mockResolvedValue({ id: 'master-1' }) };
    const controller = new PlatformWorkPartnersController(service as never);

    await expect(controller.createMaster({ code: 'C', name: 'Name', legalName: 'Legal' }, { id: 'admin-1' } as never))
      .resolves.toEqual({ data: { id: 'master-1' } });
    expect(service.createMaster).toHaveBeenCalledWith(
      { code: 'C', name: 'Name', legalName: 'Legal' },
      'admin-1',
    );
    expect(Reflect.getMetadata(ROLES_KEY, PlatformWorkPartnersController)).toEqual([UserRole.SUPER_ADMIN]);
    expect(Reflect.getMetadata(ROLES_KEY, PlatformWorkPartnersController.prototype.createMaster)).toBeUndefined();
  });

  it('takes client scope from trusted context and allows fleet managers only the active selection', async () => {
    const service = { listActiveClientPartners: vi.fn().mockResolvedValue([{ id: 'partner-1' }]) };
    const clients = { requireClientId: vi.fn().mockReturnValue('client-1') };
    const controller = new ClientWorkPartnersController(service as never, clients as never);

    await expect(controller.active({ id: 'fleet-manager-1' } as never)).resolves.toEqual({ data: [{ id: 'partner-1' }] });
    expect(service.listActiveClientPartners).toHaveBeenCalledWith('client-1');
    expect(Reflect.getMetadata(ROLES_KEY, ClientWorkPartnersController.prototype.active)).toEqual([
      UserRole.CLIENT_ADMIN,
      UserRole.FLEET_MANAGER,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, ClientWorkPartnersController.prototype.create)).toEqual([UserRole.CLIENT_ADMIN]);
    expect(ClientWorkPartnersController.prototype).not.toHaveProperty('delete');
  });
});
