import { FleetsController } from '../../fleets/fleets.controller.js';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FleetManagerActionGuard } from './fleet-manager-action.guard.js';
import { ClientContextService } from '../client-context.service.js';
import { RideReturnsController } from '../../ride-returns/ride-returns.controller.js';
import { VehicleSubmissionController } from '../../vehicle-submissions/submission.controller.js';

function setup() {
  const db = {
    userHub: { findMany: vi.fn().mockResolvedValue([{ hubId: 'own-hub' }]) },
    fleet: { count: vi.fn().mockResolvedValue(0) },
    rentalTerminationRequest: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          allocation: { fleetId: 'outside-scooter' },
          agreement: {},
        }),
    },
    vehicleExchangeRequest: {
      findFirst: vi.fn().mockResolvedValue({ oldVehicleId: 'outside-scooter' }),
    },
    vehicleSubmission: {
      findFirst: vi.fn().mockResolvedValue({ fleetId: 'outside-scooter' }),
    },
    vehicleSubmissionReport: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ submission: { fleetId: 'outside-scooter' } }),
    },
  };
  return {
    db,
    guard: new FleetManagerActionGuard(
      db as never,
      new ClientContextService(),
      new Reflector(),
    ),
  };
}
function context(
  controller: typeof RideReturnsController | typeof VehicleSubmissionController,
  handler: Function,
) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        params: { id: 'request-or-report' },
        body: { hubId: 'own-hub' },
        user: { id: 'manager', clientId: 'client', roles: ['FLEET_MANAGER'] },
      }),
    }),
  } as unknown as ExecutionContext;
}
describe('Return and submission actions require the scooter current hub', () => {
  it.each([
    [
      'return receipt',
      RideReturnsController,
      RideReturnsController.prototype.receive,
    ],
    [
      'return intake',
      VehicleSubmissionController,
      VehicleSubmissionController.prototype.startReturn,
    ],
    [
      'exchange intake',
      VehicleSubmissionController,
      VehicleSubmissionController.prototype.startExchange,
    ],
    [
      'mechanic report',
      VehicleSubmissionController,
      VehicleSubmissionController.prototype.report,
    ],
    [
      'penalty confirmation',
      VehicleSubmissionController,
      VehicleSubmissionController.prototype.confirm,
    ],
    [
      'OTP request',
      VehicleSubmissionController,
      VehicleSubmissionController.prototype.requestOtp,
    ],
  ] as const)(
    'blocks %s even if the receiving hub is assigned',
    async (_label, controller, handler) => {
      const { db, guard } = setup();
      await expect(
        guard.canActivate(context(controller, handler)),
      ).rejects.toMatchObject({
        response: { code: 'FLEET_HUB_ACCESS_REQUIRED' },
      });
      expect(db.fleet.count).toHaveBeenCalledWith({
        where: {
          clientId: 'client',
          deletedAt: null,
          id: { in: ['outside-scooter'] },
          currentHubId: { in: ['own-hub'] },
        },
      });
    },
  );
  it('allows existing submission actions when the current scooter hub is assigned', async () => {
    const { db, guard } = setup();
    db.fleet.count.mockResolvedValue(1);
    expect(
      await guard.canActivate(
        context(
          VehicleSubmissionController,
          VehicleSubmissionController.prototype.confirm,
        ),
      ),
    ).toBe(true);
  });
  it('rejects non-scalar bulk identifiers before import string coercion', async () => {
    const { guard } = setup();
    const ctx = {
      getClass: () => FleetsController, getHandler: () => FleetsController.prototype.bulkComponentMappings,
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', params: {}, body: { rows: [{ fleetCode: ['outside-scooter'] }] }, user: { id: 'manager', clientId: 'client', roles: ['FLEET_MANAGER'] } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'FLEET_HUB_ACCESS_REQUIRED' } });
  });

});
