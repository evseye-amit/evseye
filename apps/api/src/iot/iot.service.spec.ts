import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { IotService } from './iot.service.js';

const config = {
  getOrThrow: vi.fn(() => 'iot-test-secret-with-at-least-thirty-two-characters'),
};

function createService() {
  const prisma = {
    fleet: { findFirst: vi.fn().mockResolvedValue({ id: 'fleet-1' }) },
    ioTDevice: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'device-1', ...data })),
      findFirst: vi.fn(),
    },
    vehicleCurrentState: { upsert: vi.fn().mockResolvedValue({}) },
    telemetryEvent: { create: vi.fn().mockResolvedValue({}) },
  };

  return { prisma, service: new IotService(prisma as never, config as never) };
}

describe('IotService', () => {
  it('returns a one-time ingestion secret and stores only its hash', async () => {
    const { prisma, service } = createService();

    const result = await service.registerDevice('tenant-1', 'fleet-1', 'device-serial-1');

    expect(result.ingestSecret).toHaveLength(43);
    expect(prisma.ioTDevice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        fleetId: 'fleet-1',
        deviceNumber: 'device-serial-1',
        ingestSecretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(prisma.ioTDevice.create.mock.calls[0][0].data.ingestSecretHash).not.toBe(result.ingestSecret);
  });

  it('rejects an invalid secret before accepting telemetry', async () => {
    const { prisma, service } = createService();
    prisma.ioTDevice.findFirst.mockResolvedValue({
      id: 'device-1', tenantId: 'tenant-1', fleetId: 'fleet-1', ingestSecretHash: '0'.repeat(64),
    });

    await expect(service.ingest('device-serial-1', 'incorrect-secret', 'LOCATION', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.vehicleCurrentState.upsert).not.toHaveBeenCalled();
  });

  it('derives the fleet identity from authenticated device credentials', async () => {
    const { prisma, service } = createService();
    const registration = await service.registerDevice('tenant-1', 'fleet-1', 'device-serial-1');
    prisma.ioTDevice.findFirst.mockResolvedValue(registration.device);

    await expect(
      service.ingest('device-serial-1', registration.ingestSecret, 'LOCATION', { latitude: 19.076, longitude: 72.8777 }),
    ).resolves.toEqual({ fleetId: 'fleet-1' });
    expect(prisma.vehicleCurrentState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fleetId: 'fleet-1' } }),
    );
  });
});
