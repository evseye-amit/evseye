import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../../src/auth/decorators/roles.decorator.js';
import { RiderAppController } from '../../src/riders/rider-app.controller.js';

describe('RiderAppController.home', () => {
  it('forwards the authenticated rider identity and keeps the rider role boundary', async () => {
    const riderApp = { home: vi.fn().mockResolvedValue({ rentalDays: 1 }) };
    const controller = new RiderAppController(riderApp as never);

    await expect(controller.home({
      id: 'user-1', clientId: 'client-1', roles: [UserRole.RIDER],
    })).resolves.toEqual({ data: { rentalDays: 1 } });
    expect(riderApp.home).toHaveBeenCalledWith('client-1', 'user-1');
    expect(Reflect.getMetadata(ROLES_KEY, RiderAppController.prototype.home)).toEqual([UserRole.RIDER]);
    expect(new Reflector().get('__guards__', RiderAppController.prototype.home)).toBeDefined();
  });

  it('rejects an authenticated rider without a client association', async () => {
    const riderApp = { home: vi.fn() };
    const controller = new RiderAppController(riderApp as never);

    await expect(controller.home({ id: 'user-1', roles: [UserRole.RIDER] } as never)).rejects.toThrow('Rider is not associated with a client.');
    expect(riderApp.home).not.toHaveBeenCalled();
  });
});
