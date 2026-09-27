import { describe, expect, it, vi } from 'vitest';
import { RiderRateCardsService } from './rider-rate-cards.service.js';

const clientId = '11111111-1111-4111-8111-111111111111';
const otherClientId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

function setup() {
  const prisma = {
    riderRateCard: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    riderRateCardVersion: { findFirst: vi.fn() },
    rateCardRentalRate: { create: vi.fn() },
    fleet: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const audit = { record: vi.fn() };
  return {
    service: new RiderRateCardsService(prisma as never, audit as never),
    prisma,
  };
}

describe('rider rate card client isolation', () => {
  it('scopes card lookup to the authenticated client', async () => {
    const { service, prisma } = setup();
    await expect(service.get(clientId, otherClientId)).rejects.toThrow(
      'Rate card not found',
    );
    expect(prisma.riderRateCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId, id: otherClientId } }),
    );
  });
  it('rejects a child rule for a version outside the client', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue(null);
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1500',
      }),
    ).rejects.toThrow('Version not found');
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign fleet reference', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({
      status: 'DRAFT',
    });
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1500',
        fleetId: otherClientId,
      }),
    ).rejects.toThrow('Fleet does not belong to client');
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });
  it('rejects floating precision beyond currency scale', async () => {
    const { service, prisma } = setup();
    prisma.riderRateCardVersion.findFirst.mockResolvedValue({
      status: 'DRAFT',
    });
    await expect(
      service.addChild(clientId, clientId, versionId, 'rentalRates', {
        rentalPeriodType: 'WEEKLY',
        amount: '1.001',
      }),
    ).rejects.toThrow();
    expect(prisma.rateCardRentalRate.create).not.toHaveBeenCalled();
  });
});
