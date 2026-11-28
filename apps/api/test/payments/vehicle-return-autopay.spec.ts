import { describe, expect, it, vi } from 'vitest';
import { disableAutoPayAfterVehicleReturn } from '../../src/payments/vehicle-return-autopay.js';

function transaction(
  options: {
    otherAllocation?: boolean;
    enabled?: boolean;
    cancelled?: number;
  } = {},
) {
  const preference =
    options.enabled === false
      ? { id: 'preference', enabled: false }
      : {
          id: 'preference',
          enabled: true,
          mandateId: 'mandate',
          walletId: 'wallet',
        };
  return {
    $queryRaw: vi.fn(),
    allocation: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.otherAllocation ? { id: 'other' } : null),
    },
    walletAutoRechargePreference: {
      findUnique: vi.fn().mockResolvedValue(preference),
      update: vi.fn(),
    },
    paymentMandate: { updateMany: vi.fn() },
    riderPaymentProfile: { updateMany: vi.fn() },
    walletAutoRecharge: {
      updateMany: vi.fn().mockResolvedValue({ count: options.cancelled ?? 0 }),
    },
    auditLog: { create: vi.fn() },
  };
}

describe('vehicle return AutoPay shutdown', () => {
  it('disables AutoPay, cancels only unclaimed local recharges and records the return', async () => {
    const tx = transaction({ cancelled: 1 });

    await expect(
      disableAutoPayAfterVehicleReturn(
        tx as never,
        'client',
        'rider',
        'actor',
        'allocation',
      ),
    ).resolves.toEqual({
      disabled: true,
      cancelledRechargeCount: 1,
    });
    expect(tx.walletAutoRechargePreference.update).toHaveBeenCalledWith({
      where: { id: 'preference' },
      data: {
        enabled: false,
        actionRequired: false,
        revision: { increment: 1 },
      },
    });
    expect(tx.paymentMandate.updateMany).toHaveBeenCalledWith({
      where: { id: 'mandate', clientId: 'client', riderId: 'rider' },
      data: { autoDebitEnabled: false },
    });
    expect(tx.riderPaymentProfile.updateMany).toHaveBeenCalledWith({
      where: { clientId: 'client', riderId: 'rider' },
      data: { autoPayEnabled: false },
    });
    expect(tx.walletAutoRecharge.updateMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet',
        status: { in: ['CREATING', 'UNKNOWN'] },
        orderClaimedAt: null,
        debitClaimedAt: null,
        providerOrderId: null,
        providerPaymentId: null,
      },
      data: { status: 'CANCELLED', failureCode: 'VEHICLE_RETURNED' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client',
        actorId: 'actor',
        action: 'WALLET_AUTOPAY_DISABLED',
        entityType: 'RiderWallet',
        entityId: 'wallet',
        newData: {
          enabled: false,
          reason: 'VEHICLE_RETURN',
          allocationId: 'allocation',
          cancelledRechargeCount: 1,
        },
      }),
    });
  });

  it('keeps AutoPay when another active allocation exists', async () => {
    const tx = transaction({ otherAllocation: true });

    await expect(
      disableAutoPayAfterVehicleReturn(
        tx as never,
        'client',
        'rider',
        'actor',
        'allocation',
      ),
    ).resolves.toEqual({
      disabled: false,
      reason: 'ACTIVE_ALLOCATION',
    });
    expect(tx.walletAutoRechargePreference.findUnique).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent when AutoPay is already off', async () => {
    const tx = transaction({ enabled: false });

    await expect(
      disableAutoPayAfterVehicleReturn(
        tx as never,
        'client',
        'rider',
        'actor',
        'allocation',
      ),
    ).resolves.toEqual({
      disabled: false,
      reason: 'ALREADY_DISABLED',
    });
    expect(tx.walletAutoRechargePreference.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
