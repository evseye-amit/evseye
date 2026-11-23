import { describe, expect, it, vi } from 'vitest';
import {
  AllocationNotificationService,
  allocationEvents,
} from '../../src/allocations/allocation-notification.service.js';
import { AllocationsService } from '../../src/allocations/allocations.service.js';

function fixture() {
  const tx: any = {
    allocation: {
      findFirst: vi.fn(async () => ({
        rider: { clientId: 'client', userId: 'user', deletedAt: null },
      })),
    },
    user: { findFirst: vi.fn(async () => ({ id: 'user' })) },
    notificationCategory: {
      findFirst: vi.fn(async () => ({ code: 'category' })),
    },
  };
  const notifications = { enqueueForUsers: vi.fn(async () => ({})) };
  return {
    tx,
    notifications,
    service: new AllocationNotificationService(notifications as never),
  };
}
describe('allocation event notifications', () => {
  it.each(
    Object.keys(allocationEvents) as Array<keyof typeof allocationEvents>,
  )(
    'queues %s privately in the supplied business transaction',
    async (event) => {
      const { tx, service, notifications } = fixture();
      await service.enqueue(tx, 'client', 'allocation', event);
      expect(tx.allocation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'allocation', clientId: 'client' },
        }),
      );
      expect(tx.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'user',
            clientId: 'client',
            isActive: true,
            deletedAt: null,
            role: 'RIDER',
          },
        }),
      );
      expect(notifications.enqueueForUsers).toHaveBeenCalledWith(
        tx,
        'client',
        ['user'],
        {
          ...allocationEvents[event],
          application: 'RIDER',
          data: {
            schemaVersion: '1',
            action: 'ALLOCATION_DETAILS',
            event,
            allocationId: 'allocation',
          },
        },
        `allocation:allocation:${event}`,
        'ALLOCATION',
      );
    },
  );
  it('does not notify missing, deleted, cross-tenant or unlinked riders', async () => {
    for (const rider of [
      null,
      { clientId: 'other', userId: 'user' },
      { clientId: 'client', userId: null },
      { clientId: 'client', userId: 'user', deletedAt: new Date() },
    ]) {
      const { tx, service, notifications } = fixture();
      tx.allocation.findFirst.mockResolvedValue({ rider });
      await service.enqueue(tx, 'client', 'allocation', 'ACTIVATED');
      expect(notifications.enqueueForUsers).not.toHaveBeenCalled();
    }
  });
  it('allows business completion without sending for inactive recipients or disabled/unseeded categories', async () => {
    for (const table of ['user', 'notificationCategory']) {
      const { tx, service, notifications } = fixture();
      tx[table].findFirst.mockResolvedValue(null);
      await service.enqueue(tx, 'client', 'allocation', 'ACTIVATED');
      expect(notifications.enqueueForUsers).not.toHaveBeenCalled();
    }
  });
  it('uses identical event keys for retries and propagates persistence failures', async () => {
    const { tx, service, notifications } = fixture();
    await service.enqueue(tx, 'client', 'allocation', 'ACTIVATED');
    await service.enqueue(tx, 'client', 'allocation', 'ACTIVATED');
    expect(notifications.enqueueForUsers.mock.calls[0]).toEqual(
      notifications.enqueueForUsers.mock.calls[1],
    );
    notifications.enqueueForUsers.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(
      service.enqueue(tx, 'client', 'allocation', 'ACTIVATED'),
    ).rejects.toThrow('database unavailable');
  });
  it('only queues return-start on a transition and passes the enclosing transaction', async () => {
    const tx: any = {
      allocation: {
        findFirst: vi.fn(async () => ({
          id: 'a',
          fleetId: 'f',
          status: 'ACTIVE',
        })),
        update: vi.fn(),
      },
      fleet: { updateMany: vi.fn() },
      inspection: { upsert: vi.fn(async () => ({ id: 'inspection' })) },
    };
    const notifications = { enqueue: vi.fn() };
    const service = new AllocationsService(
      {} as never,
      {} as never,
      notifications as never,
    );
    await service.initiateDeallocationInTransaction(tx, 'client', 'a');
    expect(notifications.enqueue).toHaveBeenCalledWith(
      tx,
      'client',
      'a',
      'RETURN_STARTED',
    );
    tx.allocation.findFirst.mockResolvedValue({
      id: 'a',
      fleetId: 'f',
      status: 'DEALLOCATION_INITIATED',
    });
    await service.initiateDeallocationInTransaction(tx, 'client', 'a');
    expect(notifications.enqueue).toHaveBeenCalledTimes(1);
    tx.allocation.findFirst.mockResolvedValue({
      id: 'a',
      fleetId: 'f',
      status: 'ACTIVE',
    });
    notifications.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(
      service.initiateDeallocationInTransaction(tx, 'client', 'a'),
    ).rejects.toThrow('queue unavailable');
  });
});
