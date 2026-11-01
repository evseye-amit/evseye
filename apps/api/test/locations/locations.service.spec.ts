import { describe, expect, it, vi } from 'vitest';
import { LocationsService } from '../../src/locations/locations.service.js';

describe('LocationsService bulk import response', () => {
  it('returns normalized Hub failures with original row data', async () => {
    const prisma = {
      hub: { findMany: vi.fn().mockResolvedValue([{ code: 'HUB-1' }]) },
      importJob: { create: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    };
    const service = new LocationsService(prisma as never, {} as never);
    const rows = [{ code: 'hub-1', name: 'Hub 1', city: 'Pune', state: 'Maharashtra' }];

    const result = await service.bulkCreateHubs('client-1', 'actor-1', 'hubs.csv', rows);

    expect(result.failures[0]).toEqual(expect.objectContaining({
      row: 2,
      raw: expect.objectContaining({ code: 'hub-1', name: 'Hub 1', row_number: 2 }),
    }));
  });
});
