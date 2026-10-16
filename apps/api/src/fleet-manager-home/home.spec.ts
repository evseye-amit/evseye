import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { FleetManagerHomeController } from './home.controller.js';
import { FleetManagerHomeQueryDto } from './home.dto.js';
import { homeDates } from './home-metrics.js';

describe('Fleet Manager home contract', () => {
  it('uses IST midnight rather than the process timezone, including year boundaries', () => {
    expect(homeDates(new Date('2026-12-31T18:29:59.999Z'))).toEqual({
      today: '2026-12-31',
      yesterday: '2026-12-30',
      cutoff: new Date('2026-12-30T18:30:00Z'),
    });
    expect(homeDates(new Date('2026-12-31T18:30:00Z'))).toEqual({
      today: '2027-01-01',
      yesterday: '2026-12-31',
      cutoff: new Date('2026-12-31T18:30:00Z'),
    });
  });
  it('validates optional hub IDs', async () => {
    expect(await validate(new FleetManagerHomeQueryDto())).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new FleetManagerHomeQueryDto(), { hubId: 'not-an-id' }),
      ),
    ).toHaveLength(1);
  });
  it('only allows Fleet Managers through the actual controller role metadata', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (roles: string[]) => ({
      getHandler: () => FleetManagerHomeController.prototype.get,
      getClass: () => FleetManagerHomeController,
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    });
    expect(guard.canActivate(context(['FLEET_MANAGER']) as never)).toBe(true);
    for (const roles of [[], ['RIDER'], ['CLIENT_ADMIN']])
      expect(() => guard.canActivate(context(roles) as never)).toThrow(
        'permission',
      );
  });
});
