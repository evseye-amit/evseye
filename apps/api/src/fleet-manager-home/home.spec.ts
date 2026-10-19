import { describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { FleetManagerHomeController } from './home.controller.js';
import { FleetManagerHomeQueryDto } from './home.dto.js';
import { homeDates } from './home-metrics.js';
import { FleetManagerHomeService } from './home.service.js';

describe('Fleet Manager home contract', () => {
  it.each([
    { businessProfile: { gstin: '06ABCDE1234F1Z5' }, branding: { supportPhone: '+919876543210' } },
    { businessProfile: null, branding: null },
    { businessProfile: { gstin: null }, branding: { supportPhone: null } },
  ])('returns client company details with and without an assigned hub: %j', async (client) => {
    for (const assigned of [false, true]) {
      const tx = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ now: new Date('2026-10-19T06:00:00Z') }])
          .mockResolvedValueOnce([{ totalFleet: 0 }])
          .mockResolvedValueOnce([{ present: 0 }]),
        user: { findFirst: vi.fn().mockResolvedValue({ id: 'manager', name: 'Manager' }), count: vi.fn().mockResolvedValue(0) },
        userHub: { findMany: vi.fn().mockResolvedValue(assigned ? [{ hubId: 'hub', isPrimary: true, hub: { id: 'hub', latitude: null, longitude: null } }] : []) },
        attendancePeriod: { findFirst: vi.fn().mockResolvedValue(null) },
        client: { findUnique: vi.fn().mockResolvedValue(client) },
        fleetManagerHomeHistoryCoverage: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      const service = new FleetManagerHomeService({ $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as never);
      const result = await service.get('client-1', 'manager');
      expect(result.state).toBe(assigned ? 'READY' : 'HUB_NOT_ASSIGNED');
      expect(result.company).toEqual({
        gstin: client.businessProfile?.gstin ?? null,
        supportNumber: client.branding?.supportPhone ?? null,
      });
      expect(tx.client.findUnique).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        select: { businessProfile: { select: { gstin: true } }, branding: { select: { supportPhone: true } } },
      });
    }
  });
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
