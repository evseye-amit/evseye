import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const seedSource = readFileSync(
  new URL('../../prisma/seed-yogmaya.mjs', import.meta.url),
  'utf8',
);

describe('fleet seed upsert', () => {
  it('keeps the configured status for new fleets without overwriting runtime status', async () => {
    type FleetRecord = Record<string, unknown>;
    type FleetUpsertInput = {
      create: FleetRecord;
      update: FleetRecord;
      where: Record<string, unknown>;
    };
    type FakePrisma = {
      fleet: {
        upsert(input: FleetUpsertInput): Promise<FleetRecord>;
      };
    };

    // Execute only the fleet upsert block with an isolated mock instead of
    // importing the consolidated seed and touching a database.
    const fleetUpsertStart = seedSource.indexOf(
      'const { status: _status, ...fleetUpdate } = fleetRecord;',
    );
    const endMarker = '\n  });';
    const fleetUpsertEnd = seedSource.indexOf(endMarker, fleetUpsertStart);
    expect(fleetUpsertStart).toBeGreaterThanOrEqual(0);
    expect(fleetUpsertEnd).toBeGreaterThan(fleetUpsertStart);

    const fleetUpsertSource = seedSource.slice(
      fleetUpsertStart,
      fleetUpsertEnd + endMarker.length,
    );
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>;
    const executeFleetUpsert = new AsyncFunction(
      'prisma',
      'fleetRecord',
      'fleetData',
      'client',
      `${fleetUpsertSource}\nreturn fleet;`,
    ) as unknown as (
      prisma: FakePrisma,
      fleetRecord: FleetRecord,
      fleetData: FleetRecord,
      client: { id: string },
    ) => Promise<FleetRecord>;
    const fleetRecord = {
      fleetCode: 'EV000001',
      status: 'AVAILABLE',
      allocationEnabled: true,
    };
    const fleetData = { fleetCode: fleetRecord.fleetCode };
    const client = { id: 'client-1' };

    const freshUpsert = vi.fn(async ({ create }: FleetUpsertInput) => create);
    const freshFleet = await executeFleetUpsert(
      { fleet: { upsert: freshUpsert } },
      fleetRecord,
      fleetData,
      client,
    );
    expect(freshFleet.status).toBe('AVAILABLE');
    expect(freshUpsert.mock.calls[0]?.[0].create.status).toBe('AVAILABLE');

    for (const existingStatus of ['RESERVED', 'ALLOCATED']) {
      const existing = { id: 'fleet-1', status: existingStatus };
      const updateUpsert = vi.fn(
        async ({ update }: FleetUpsertInput) => ({ ...existing, ...update }),
      );
      const updatedFleet = await executeFleetUpsert(
        { fleet: { upsert: updateUpsert } },
        fleetRecord,
        fleetData,
        client,
      );
      const input = updateUpsert.mock.calls[0]?.[0];

      expect(input?.update).not.toHaveProperty('status');
      expect(updatedFleet.status).toBe(existingStatus);
    }
  });
});
