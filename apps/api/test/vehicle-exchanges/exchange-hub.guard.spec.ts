import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../../src/auth/client-context.service.js';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import {
  ExchangeHubGuard,
  type ExchangeHubRequest,
} from '../../src/vehicle-exchanges/exchange-hub.guard.js';
import {
  RiderVehicleExchangeController,
  VehicleExchangeController,
} from '../../src/vehicle-exchanges/vehicle-exchange.controller.js';

function context(
  request: ExchangeHubRequest,
  handler = VehicleExchangeController.prototype.details,
  controller: unknown = VehicleExchangeController,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}
function fixture() {
  const request: ExchangeHubRequest = {
    user: {
      id: 'manager',
      clientId: 'client',
      roles: [UserRole.FLEET_MANAGER],
    },
    method: 'POST',
    params: { id: 'exchange' },
  };
  const db = {
    userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'hub-a' }]) },
    fleet: {
      findMany: vi.fn().mockResolvedValue([{ id: 'old-fleet' }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'replacement' }),
    },
    vehicleExchangeRequest: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'exchange', replacementVehicleId: null }),
    },
  };
  return {
    request,
    db,
    guard: new ExchangeHubGuard(db as never, new ClientContextService()),
  };
}
describe('Fleet Manager exchange access', () => {
  const methods = [
    'list',
    'details',
    'approve',
    'rejectRequest',
    'select',
    'preview',
    'present',
    'accept',
    'reject',
    'reconcile',
    'handover',
    'complete',
    'cancel',
  ] as const;
  it.each(methods)(
    'allows Fleet Manager on %s while retaining admin/operations access and rejecting Riders',
    (method) => {
      const f = fixture();
      const guard = new RolesGuard(new Reflector());
      const ctx = context(
        f.request,
        VehicleExchangeController.prototype[method] as never,
      );
      expect(guard.canActivate(ctx)).toBe(true);
      for (const role of [UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER]) {
        f.request.user.roles = [role];
        expect(guard.canActivate(ctx)).toBe(true);
      }
      f.request.user.roles = [UserRole.RIDER];
      expect(() => guard.canActivate(ctx)).toThrow('permission');
    },
  );
  it.each([
    'setPolicy',
    'policy',
    'history',
    'request',
    'startReturn',
    'confirmReturn',
  ] as const)('keeps %s unavailable to Fleet Managers', (method) => {
    const f = fixture();
    expect(() =>
      new RolesGuard(new Reflector()).canActivate(
        context(
          f.request,
          VehicleExchangeController.prototype[method] as never,
        ),
      ),
    ).toThrow('permission');
  });
  it('applies the hub guard to staff routes without changing Rider ownership guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, VehicleExchangeController),
    ).toContain(ExchangeHubGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, RiderVehicleExchangeController),
    ).not.toContain(ExchangeHubGuard);
  });
  it('sets an assigned-hub filter on list requests and uses active hubs from the same client', async () => {
    const f = fixture();
    f.request.method = 'GET';
    f.request.params = {};
    expect(await f.guard.canActivate(context(f.request))).toBe(true);
    expect(f.db.userHub.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clientId: 'client',
          userId: 'manager',
          hub: { clientId: 'client', status: 'ACTIVE', deletedAt: null },
        },
      }),
    );
    expect(f.request.exchangeHubIds).toEqual(['hub-a']);
    expect(f.request.exchangeHubFilter).toBeDefined();
    expect(f.db.vehicleExchangeRequest.findFirst).not.toHaveBeenCalled();
  });
  it('rejects exchanges outside the hub scope before any business handler runs', async () => {
    const f = fixture();
    f.db.vehicleExchangeRequest.findFirst.mockResolvedValue(null);
    await expect(f.guard.canActivate(context(f.request))).rejects.toThrow(
      'assigned hubs',
    );
    expect(f.db.vehicleExchangeRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'exchange',
          clientId: 'client',
          AND: f.request.exchangeHubFilter,
        },
      }),
    );
    expect(f.db.fleet.findFirst).not.toHaveBeenCalled();
  });
  it('uses an empty scope when no hubs are assigned', async () => {
    const f = fixture();
    f.db.userHub.findMany.mockResolvedValue([]);
    f.request.params = {};
    f.request.method = 'GET';
    await f.guard.canActivate(context(f.request));
    expect(f.request.exchangeHubIds).toEqual([]);
    expect(f.db.fleet.findMany).not.toHaveBeenCalled();
  });
  it('rejects a proposed replacement scooter or hub outside assignments', async () => {
    const f = fixture();
    f.request.body = { vehicleId: 'foreign' };
    f.db.fleet.findFirst.mockResolvedValue(null);
    await expect(f.guard.canActivate(context(f.request))).rejects.toThrow(
      'replacement scooter',
    );
    expect(f.db.fleet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'foreign',
          clientId: 'client',
          currentHubId: { in: ['hub-a'] },
          deletedAt: null,
        },
      }),
    );
    f.request.body = { hubId: 'hub-b' };
    await expect(f.guard.canActivate(context(f.request))).rejects.toThrow(
      'replacement hub',
    );
  });
  it('also checks the already-selected replacement before mutations', async () => {
    const f = fixture();
    f.db.vehicleExchangeRequest.findFirst.mockResolvedValue({
      id: 'exchange',
      replacementVehicleId: 'foreign',
    } as never);
    f.db.fleet.findFirst.mockResolvedValue(null);
    await expect(f.guard.canActivate(context(f.request))).rejects.toThrow(
      'replacement scooter',
    );
  });
  it('retains client-wide access for client admins', async () => {
    const f = fixture();
    f.request.user.roles = [UserRole.FLEET_MANAGER, UserRole.CLIENT_ADMIN];
    expect(await f.guard.canActivate(context(f.request))).toBe(true);
    expect(f.db.userHub.findMany).not.toHaveBeenCalled();
  });
  it('passes the scoped filter and hub IDs into list and replacement reservation handlers', async () => {
    const f = fixture();
    await f.guard.canActivate(context(f.request));
    const service = { list: vi.fn(), select: vi.fn() };
    const controller = new VehicleExchangeController(
      service as never,
      new ClientContextService(),
    );
    controller.list(f.request.user, f.request);
    controller.select(
      f.request.user,
      'exchange',
      { vehicleId: 'replacement' },
      f.request,
    );
    expect(service.list).toHaveBeenCalledWith(
      'client',
      undefined,
      f.request.exchangeHubFilter,
    );
    expect(service.select).toHaveBeenCalledWith(
      'client',
      'exchange',
      'manager',
      { vehicleId: 'replacement' },
      ['hub-a'],
    );
  });
});
