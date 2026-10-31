import { readFileSync } from 'node:fs';
import { FleetStatus, FleetTransferStatus, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FleetsService } from '../../src/fleets/fleets.service.js';

describe('fleet hub transfers', () => {
  it('binds both readiness receipt exceptions to the current transaction', () => {
    const migration = readFileSync(
      new URL(
        '../../prisma/migrations/20261101000500_non_schema_consolidated/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const marker =
      "t.id = NULLIF(current_setting('evseye.fleet_transfer_receipt_id', true), '')";
    expect(migration.split(marker).length - 1).toBe(2);
    expect(migration).not.toContain('INSERT INTO "FleetTransfer"');
    expect(migration).toContain(
      "IF disabled THEN RAISE EXCEPTION 'FLEET_ALLOCATION_BLOCKED: Allocation is administratively disabled.'",
    );
    expect(migration).toContain(
      "IF prep_mode AND approved IS NULL THEN RAISE EXCEPTION 'PREPARATION_QC_REQUIRED: Scooter requires current preparation and QC approval.'",
    );
  });

  it('starts an explicit transfer only from an available fleet', async () => {
    const fleet = {
      id: 'fleet-1',
      clientId: 'client-1',
      status: FleetStatus.AVAILABLE,
      currentHubId: 'hub-a',
      allocationBlockedByAdmin: false,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleet: { findFirst: vi.fn().mockResolvedValue(fleet), update: vi.fn() },
      hub: { findFirst: vi.fn().mockResolvedValue({ id: 'hub-b' }) },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetTransfer: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new FleetsService(prisma as never, {} as never);
    vi.spyOn(service, 'get').mockResolvedValue({
      ...fleet,
      activeTransfer: { id: 'transfer-1' },
    } as never);

    await service.startTransfer('client-1', fleet.id, 'hub-b', 'operator-1');

    expect(tx.fleetTransfer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        fleetId: fleet.id,
        fromHubId: 'hub-a',
        toHubId: 'hub-b',
        status: FleetTransferStatus.IN_TRANSIT,
      }),
    });
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: fleet.id },
      data: { status: FleetStatus.IN_TRANSIT, allocationEnabled: false },
    });
  });

  it('requires destination assignment for a fleet-manager receipt', async () => {
    const transfer = {
      id: 'transfer-1',
      clientId: 'client-1',
      fleetId: 'fleet-1',
      fromHubId: 'hub-a',
      toHubId: 'hub-b',
      status: FleetTransferStatus.IN_TRANSIT,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleetTransfer: {
        findFirst: vi.fn().mockResolvedValue(transfer),
        findFirstOrThrow: vi.fn().mockResolvedValue(transfer),
      },
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fleet-1',
          status: FleetStatus.IN_TRANSIT,
          currentHubId: 'hub-a',
          allocationBlockedByAdmin: false,
        }),
      },
      hub: { findFirst: vi.fn().mockResolvedValue({ id: 'hub-b' }) },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      userHub: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    };
    const service = new FleetsService(prisma as never, {} as never);

    await expect(
      service.receiveTransfer('client-1', transfer.id, {
        id: 'manager-1',
        clientId: 'client-1',
        roles: [UserRole.FLEET_MANAGER],
      }),
    ).rejects.toThrow('not assigned to the destination hub');
    expect(tx.fleetTransfer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: transfer.id, clientId: 'client-1' } }),
    );
  });

  it('marks the receipt transaction before moving the fleet hub', async () => {
    const transfer = {
      id: 'transfer-1',
      clientId: 'client-1',
      fleetId: 'fleet-1',
      fromHubId: 'hub-a',
      toHubId: 'hub-b',
      status: FleetTransferStatus.IN_TRANSIT,
    };
    const tx = {
      $queryRaw: vi.fn(),
      fleetTransfer: {
        findFirst: vi.fn().mockResolvedValue(transfer),
        findFirstOrThrow: vi.fn().mockResolvedValue(transfer),
        update: vi.fn(),
      },
      fleet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fleet-1',
          status: FleetStatus.IN_TRANSIT,
          currentHubId: 'hub-a',
          allocationBlockedByAdmin: false,
        }),
        update: vi.fn(),
      },
      hub: { findFirst: vi.fn().mockResolvedValue({ id: 'hub-b' }) },
      allocation: { count: vi.fn().mockResolvedValue(0) },
      fleetStatusHistory: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
      fleetTransfer: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          ...transfer,
          status: FleetTransferStatus.RECEIVED,
        }),
      },
    };
    const service = new FleetsService(prisma as never, {} as never);
    vi.spyOn(service, 'get').mockResolvedValue({
      id: transfer.fleetId,
      currentHubId: transfer.toHubId,
    } as never);

    await service.receiveTransfer('client-1', transfer.id, {
      id: 'admin-1',
      clientId: 'client-1',
      roles: [UserRole.CLIENT_ADMIN],
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const rawCalls = tx.$queryRaw.mock.calls.map(([strings]) =>
      (strings as TemplateStringsArray).join(''),
    );
    expect(rawCalls[1]).toContain(
      "set_config('evseye.fleet_transfer_receipt_id'",
    );
    expect(tx.fleetTransfer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: transfer.id } }),
    );
    expect(tx.fleet.update).toHaveBeenCalledWith({
      where: { id: transfer.fleetId },
      data: expect.objectContaining({ currentHubId: transfer.toHubId }),
    });
  });
});
