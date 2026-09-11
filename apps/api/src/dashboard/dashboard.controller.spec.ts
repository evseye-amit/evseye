import { describe, expect, it, vi } from 'vitest';
import { DashboardController } from './dashboard.controller.js';

describe('DashboardController', () => {
  it('resolves the service result before wrapping it in the API response', async () => {
    const summary = {
      fleet: { AVAILABLE: 1 },
      riders: { ACTIVE: 1 },
      kyc: { PENDING: 1 },
      operations: {
        allocationsToday: 0,
        deallocationsToday: 0,
        activeAllocations: 0,
      },
      iot: { online: 0, offline: 0 },
    };
    const dashboard = { summary: vi.fn().mockResolvedValue(summary) };
    const tenants = { requireTenantId: vi.fn().mockReturnValue('tenant-1') };
    const controller = new DashboardController(
      dashboard as never,
      tenants as never,
    );

    await expect(
      controller.summary({ id: 'user-1', tenantId: 'tenant-1', roles: [] }),
    ).resolves.toEqual({ data: summary });
  });
});
