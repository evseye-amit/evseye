import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service.js';

export const allocationEvents = {
  REQUESTED: {
    categoryCode: 'PG04_VEHICLE_ALLOCATION',
    title: 'Vehicle allocation started',
    body: 'Your vehicle allocation has started. Open the app to review the next steps.',
  },
  ACTIVATED: {
    categoryCode: 'PG03_VEHICLE_HANDOVER',
    title: 'Vehicle handover complete',
    body: 'Your vehicle handover is complete and your allocation is active.',
  },
  RETURN_STARTED: {
    categoryCode: 'PG03_VEHICLE_RETURN',
    title: 'Vehicle return started',
    body: 'Your vehicle return process has started. Open the app to review the next steps.',
  },
  RETURN_COMPLETED: {
    categoryCode: 'PG03_VEHICLE_RETURN',
    title: 'Vehicle return complete',
    body: 'Your vehicle return is complete. Any final billing or settlement is handled separately.',
  },
} as const;

@Injectable()
export class AllocationNotificationService {
  constructor(private readonly notifications: NotificationService) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    clientId: string,
    allocationId: string,
    event: keyof typeof allocationEvents,
  ) {
    const definition = allocationEvents[event];
    const allocation = await tx.allocation.findFirst({
      where: { id: allocationId, clientId },
      select: {
        rider: { select: { clientId: true, userId: true, deletedAt: true } },
      },
    });
    const rider = allocation?.rider;
    if (
      !rider ||
      rider.clientId !== clientId ||
      rider.deletedAt ||
      !rider.userId
    )
      return;
    const user = await tx.user.findFirst({
      where: {
        id: rider.userId,
        clientId,
        isActive: true,
        deletedAt: null,
        role: 'RIDER',
      },
      select: { id: true },
    });
    if (!user) return;
    // Disabling a catalog category must not prevent a vehicle handover or return.
    const category = await tx.notificationCategory.findFirst({
      where: {
        code: definition.categoryCode,
        isActive: true,
        parent: { isActive: true },
        applications: { some: { application: 'RIDER', allowed: true } },
      },
      select: { code: true },
    });
    if (!category) return;
    await this.notifications.enqueueForUsers(
      tx,
      clientId,
      [user.id],
      {
        ...definition,
        application: 'RIDER',
        data: {
          schemaVersion: '1',
          action: 'ALLOCATION_DETAILS',
          event,
          allocationId,
        },
      },
      `allocation:${allocationId}:${event}`,
      'ALLOCATION',
    );
  }
}
