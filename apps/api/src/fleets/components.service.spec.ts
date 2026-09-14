import { BatterySlot, BatteryStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ComponentsService } from './components.service.js';

describe('ComponentsService', () => {
  it('retires a current slot assignment before installing its replacement', async () => {
    const tx = {
      fleetBatteryHistory: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'history-1', batteryId: 'battery-old' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'history-2' }),
      },
      battery: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          id: 'battery-new',
          serialNumber: 'BAT-NEW',
        }),
      },
    };
    const prisma = {
      fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) },
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ComponentsService(prisma as never);

    const battery = await service.addBattery('client-1', 'fleet-1', {
      serialNumber: 'bat-new',
      batterySlot: BatterySlot.PRIMARY,
      installedOdometerKm: 10.5,
    });

    expect(battery).toMatchObject({ serialNumber: 'BAT-NEW' });
    expect(tx.fleetBatteryHistory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['history-1'] } },
        data: expect.objectContaining({ removedOdometerKm: 10.5 }),
      }),
    );
    expect(tx.battery.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['battery-old'] } },
      data: { status: BatteryStatus.AVAILABLE },
    });
    expect(tx.fleetBatteryHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fleetId: 'fleet-1',
          batterySlot: BatterySlot.PRIMARY,
          installedOdometerKm: 10.5,
        }),
      }),
    );
  });
});
