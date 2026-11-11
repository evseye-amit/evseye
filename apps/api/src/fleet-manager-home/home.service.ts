import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  HOME_TIMEZONE,
  homeCountsQuery,
  homeDates,
  riderAttendanceQuery,
  type HomeCounts,
} from './home-metrics.js';

function cards(counts: HomeCounts) {
  return {
    pendingAllocation: counts.pendingAllocation,
    pendingSubmission: counts.pendingSubmission,
    readyForDeployment: counts.readyForDeployment,
    underMaintenance: counts.underMaintenance,
  };
}

@Injectable()
export class FleetManagerHomeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(clientId: string, userId: string, requestedHubId?: string) {
    return this.prisma.$transaction(
      async (tx) => {
        // Read the clock after PostgreSQL establishes the consistent snapshot.
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT transaction_timestamp() AS now`;
        const now = clock.now;
        const { today, yesterday, cutoff } = homeDates(now);
        const [manager, assignments, attendance, client] = await Promise.all([
          tx.user.findFirst({
            where: {
              id: userId,
              clientId,
              role: 'FLEET_MANAGER',
              isActive: true,
              deletedAt: null,
            },
            select: { id: true, name: true },
          }),
          tx.userHub.findMany({
            where: {
              clientId,
              userId,
              hub: { clientId, status: 'ACTIVE', deletedAt: null },
            },
            include: { hub: true },
            orderBy: [{ isPrimary: 'desc' }, { hubId: 'asc' }],
          }),
          tx.attendancePeriod.findFirst({
            where: {
              clientId,
              userId,
              checkInAt: { lte: now },
              OR: [{ checkOutAt: null }, { checkOutAt: { gt: now } }],
            },
            select: { id: true, checkInAt: true },
            orderBy: { checkInAt: 'desc' },
          }),
          tx.client.findUnique({
            where: { id: clientId },
            select: {
              businessProfile: { select: { gstin: true } },
              branding: { select: { supportPhone: true } },
            },
          }),
        ]);
        if (!manager)
          throw new NotFoundException('Active Fleet Manager not found.');
        const selected = requestedHubId
          ? assignments.find((item) => item.hubId === requestedHubId)
          : assignments[0];
        if (requestedHubId && !selected)
          throw new NotFoundException(
            'Hub not found in your active assigned hubs.',
          );
        const base = {
          generatedAt: now.toISOString(),
          timezone: HOME_TIMEZONE,
          date: today,
          company: {
            gstin: client?.businessProfile?.gstin ?? null,
            supportNumber: client?.branding?.supportPhone ?? null,
          },
          manager: {
            ...manager,
            attendance: {
              status: attendance ? 'PRESENT' : 'ABSENT',
              periodId: attendance?.id ?? null,
              checkInAt: attendance?.checkInAt.toISOString() ?? null,
            },
          },
          availableHubs: assignments.map(({ hub, isPrimary }) => ({
            id: hub.id,
            code: hub.code,
            name: hub.name,
            isPrimary,
          })),
        };
        if (!selected)
          return {
            ...base,
            state: 'HUB_NOT_ASSIGNED',
            message: 'No active hub is assigned to this Fleet Manager.',
            hub: null,
            summary: null,
            yesterday: null,
          };
        const hub = selected.hub;
        const coverage = await tx.fleetManagerHomeHistoryCoverage.findUnique({
          where: { id: 'initial' },
        });
        const hasHistory = !!coverage && coverage.availableFrom < cutoff;
        const [
          currentRows,
          yesterdayRows,
          riderAttendance,
          onShift,
          assignedManagers,
        ] = await Promise.all([
          tx.$queryRaw<HomeCounts[]>(homeCountsQuery(clientId, hub.id, now)),
          hasHistory
            ? tx.$queryRaw<HomeCounts[]>(
                homeCountsQuery(clientId, hub.id, now, cutoff),
              )
            : Promise.resolve(null),
          tx.$queryRaw<{ present: number }[]>(
            riderAttendanceQuery(clientId, hub.id, now),
          ),
          tx.user.count({
            where: {
              clientId,
              role: 'FLEET_MANAGER',
              isActive: true,
              deletedAt: null,
              hubAssignments: { some: { clientId, hubId: hub.id } },
              attendancePeriods: {
                some: {
                  clientId,
                  checkInAt: { lte: now },
                  OR: [{ checkOutAt: null }, { checkOutAt: { gt: now } }],
                },
              },
            },
          }),
          tx.user.count({
            where: {
              clientId,
              role: 'FLEET_MANAGER',
              isActive: true,
              deletedAt: null,
              hubAssignments: { some: { clientId, hubId: hub.id } },
            },
          }),
        ]);
        const current = currentRows[0];
        return {
          ...base,
          state: 'READY',
          hub: {
            id: hub.id,
            code: hub.code,
            name: hub.name,
            address: {
              line1: hub.addressLine1,
              line2: hub.addressLine2,
              landmark: hub.landmark,
              city: hub.city,
              district: hub.district,
              state: hub.state,
              postalCode: hub.postalCode,
              country: hub.country,
              formatted: [
                hub.addressLine1,
                hub.addressLine2,
                hub.landmark,
                hub.city,
                hub.state,
                hub.postalCode,
              ]
                .filter(Boolean)
                .join(', '),
            },
            location: {
              latitude: hub.latitude === null ? null : Number(hub.latitude),
              longitude: hub.longitude === null ? null : Number(hub.longitude),
            },
            parking: {
              occupiedSlots: current.occupiedSlots,
              capacity: hub.parkingSlots ?? hub.vehicleCapacity,
              occupancySource: 'RECORDED_VEHICLE_STATUS',
            },
          },
          summary: {
            fleetUtilisation: {
              percentage: current.totalFleet
                ? Math.round(
                    (current.allocatedFleet / current.totalFleet) * 10000,
                  ) / 100
                : null,
              allocated: current.allocatedFleet,
              total: current.totalFleet,
            },
            onShift: {
              present: onShift,
              total: assignedManagers,
              role: 'FLEET_MANAGER',
            },
            riders: {
              present: riderAttendance[0].present,
              active: current.activeRiders,
            },
            ...cards(current),
          },
          yesterday: {
            date: yesterday,
            asOfExclusive: cutoff.toISOString(),
            status: hasHistory ? 'AVAILABLE' : 'UNAVAILABLE',
            reason: hasHistory ? null : 'HISTORY_NOT_AVAILABLE_FOR_DATE',
            historyAvailableFrom: coverage?.availableFrom.toISOString() ?? null,
            counts: yesterdayRows ? cards(yesterdayRows[0]) : null,
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
