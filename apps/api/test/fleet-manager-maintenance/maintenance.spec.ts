import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/auth/guards/roles.guard.js';
import { FleetManagerMaintenanceController } from '../../src/fleet-manager-maintenance/maintenance.controller.js';
import { MaintenanceFleetsQueryDto } from '../../src/fleet-manager-maintenance/maintenance.dto.js';

describe('maintenance API contract', () => {
  it('validates pagination, hub IDs and search bounds', async () => {
    expect(await validate(new MaintenanceFleetsQueryDto())).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new MaintenanceFleetsQueryDto(), {
          page: 0,
          pageSize: 101,
          hubId: 'bad',
          search: 'a'.repeat(101),
        }),
      ),
    ).toHaveLength(4);
  });
  it('restricts both routes to Fleet Managers', () => {
    const guard = new RolesGuard(new Reflector());
    for (const method of ['list', 'get'] as const) {
      const context = (roles: string[]) => ({
        getClass: () => FleetManagerMaintenanceController,
        getHandler: () => FleetManagerMaintenanceController.prototype[method],
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
      });
      expect(guard.canActivate(context(['FLEET_MANAGER']) as never)).toBe(true);
      for (const roles of [[], ['RIDER'], ['CLIENT_ADMIN']])
        expect(() => guard.canActivate(context(roles) as never)).toThrow(
          'permission',
        );
    }
  });
});
