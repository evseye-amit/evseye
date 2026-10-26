import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { MaintenanceFleetsQueryDto } from './maintenance.dto.js';

const fleetSelect = {
  id: true,
  fleetCode: true,
  vehicleNumber: true,
  chassisNumber: true,
  modelName: true,
  variantName: true,
  colour: true,
  status: true,
  onboardingStatus: true,
  allocationEnabled: true,
  odometerKm: true,
  oem: { select: { id: true, code: true, name: true, displayName: true } },
  vehicleType: { select: { id: true, code: true, name: true } },
  vehicleCategory: { select: { id: true, code: true, name: true } },
  currentHub: { select: { id: true, code: true, name: true } },
  homeHub: { select: { id: true, code: true, name: true } },
  updatedAt: true,
  statusHistory: {
    where: { toStatus: { in: ['MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'] } },
    select: { id: true, reason: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} satisfies Prisma.FleetSelect;

function fleetFields(
  fleet: Prisma.FleetGetPayload<{ select: typeof fleetSelect }>,
) {
  const { statusHistory, ...fields } = fleet;
  return {
    ...fields,
    hub: fields.currentHub ?? fields.homeHub,
    lastRecordedMaintenanceChange: statusHistory[0] ?? null,
  };
}

const reportSelect = {
  id: true,
  stage: true,
  mechanicName: true,
  summary: true,
  fleetStatus: true,
  safeForReuse: true,
  unsafeReason: true,
  checksComplete: true,
  evidencePhotoIds: true,
  createdAt: true,
  confirmedAt: true,
  status: true,
  submission: { select: { id: true, inspectionId: true } },
} satisfies Prisma.VehicleSubmissionReportSelect;

@Injectable()
export class FleetManagerMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async hubs(
    tx: Prisma.TransactionClient,
    clientId: string,
    userId: string,
    selected?: string,
  ) {
    const assignments = await tx.userHub.findMany({
      where: {
        clientId,
        userId,
        hub: { clientId, status: 'ACTIVE', deletedAt: null },
      },
      include: { hub: { select: { id: true, code: true, name: true } } },
      orderBy: { hubId: 'asc' },
    });
    if (selected && !assignments.some((row) => row.hubId === selected))
      throw new NotFoundException(
        'Hub not found in your active assigned hubs.',
      );
    return selected
      ? assignments.filter((row) => row.hubId === selected)
      : assignments;
  }

  private scope(clientId: string, hubIds: string[]): Prisma.FleetWhereInput {
    return {
      clientId,
      status: { in: ['MAINTENANCE', 'BROKEN', 'AWAITING_PARTS'] },
      deletedAt: null,
      OR: [
        {
          currentHubId: { in: hubIds },
          currentHub: { is: { clientId, status: 'ACTIVE', deletedAt: null } },
        },
        {
          currentHubId: null,
          homeHubId: { in: hubIds },
          homeHub: { is: { clientId, status: 'ACTIVE', deletedAt: null } },
        },
      ],
    };
  }

  async list(
    clientId: string,
    userId: string,
    query: MaintenanceFleetsQueryDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const hubs = await this.hubs(tx, clientId, userId, query.hubId);
        const base = this.scope(
          clientId,
          hubs.map((row) => row.hubId),
        );
        const where: Prisma.FleetWhereInput = {
          AND: [
            base,
            query.fleetStatus ? { status: query.fleetStatus } : {},
            query.search
              ? {
                  OR: [
                    'vehicleNumber',
                    'fleetCode',
                    'chassisNumber',
                    'modelName',
                  ].map((field) => ({
                    [field]: { contains: query.search, mode: 'insensitive' },
                  })),
                }
              : {},
          ],
        };
        const [items, total, underMaintenance] = await Promise.all([
          tx.fleet.findMany({
            where,
            select: fleetSelect,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.fleet.count({ where }),
          tx.fleet.count({ where: base }),
        ]);
        // Fetch only one finalized report per fleet, without an unbounded report query for each card.
        const latest = items.length
          ? await tx.$queryRaw<{ id: string; fleetId: string }[]>(Prisma.sql`
        SELECT DISTINCT ON (s."fleetId") r.id, s."fleetId" FROM "VehicleSubmissionReport" r
        JOIN "VehicleSubmission" s ON s.id = r."submissionId" AND s."clientId" = ${clientId}
        WHERE r."clientId" = ${clientId} AND r.status = 'POSTED' AND s."fleetId" IN (${Prisma.join(items.map((item) => item.id))})
        ORDER BY s."fleetId", r."createdAt" DESC, r.id DESC
      `)
          : [];
        const reports = latest.length
          ? await tx.vehicleSubmissionReport.findMany({
              where: { clientId, id: { in: latest.map((row) => row.id) } },
              select: reportSelect,
            })
          : [];
        const reportById = new Map(
          reports.map((report) => [report.id, report]),
        );
        const reportByFleet = new Map(
          latest.map((row) => [row.fleetId, reportById.get(row.id) ?? null]),
        );
        return {
          items: items.map((item) => ({
            ...fleetFields(item),
            latestMechanicReport: reportByFleet.get(item.id) ?? null,
          })),
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: Math.ceil(total / query.pageSize),
          },
          summary: { underMaintenance },
          hubs: hubs.map((row) => row.hub),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async get(clientId: string, userId: string, fleetId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const hubs = await this.hubs(tx, clientId, userId);
        const fleet = await tx.fleet.findFirst({
          where: {
            ...this.scope(
              clientId,
              hubs.map((row) => row.hubId),
            ),
            id: fleetId,
          },
          select: fleetSelect,
        });
        if (!fleet)
          throw new NotFoundException(
            'Maintenance fleet not found in your active assigned hubs.',
          );
        const [history, reports] = await Promise.all([
          tx.fleetStatusHistory.findMany({
            where: { fleetId },
            select: {
              id: true,
              fromStatus: true,
              toStatus: true,
              reason: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 101,
          }),
          tx.vehicleSubmissionReport.findMany({
            where: {
              clientId,
              status: 'POSTED',
              submission: { clientId, fleetId },
            },
            select: reportSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 51,
          }),
        ]);
        const visibleReports = reports.slice(0, 50);
        const photoIds = [
          ...new Set(
            visibleReports.flatMap((report) => report.evidencePhotoIds),
          ),
        ];
        const evidencePhotos = photoIds.length
          ? await tx.photo.findMany({
              where: {
                clientId,
                id: { in: photoIds },
                status: 'COMPLETE',
                workFlowType: 'FLEET_SUBMISSION',
                subjectType: 'INSPECTION',
                entityId: {
                  in: visibleReports.map(
                    (report) => report.submission.inspectionId,
                  ),
                },
              },
              select: {
                id: true,

                entityId: true,
                photoType: true,
                mimeType: true,
                uploadedAt: true,
              },
            })
          : [];
        return {
          fleet: fleetFields(fleet),
          latestMechanicReport: visibleReports[0] ?? null,
          statusHistory: history.slice(0, 100),
          mechanicReports: visibleReports,
          evidencePhotos,
          historyMeta: {
            statusHistoryLimit: 100,
            hasMoreStatusHistory: history.length > 100,
            mechanicReportLimit: 50,
            hasMoreMechanicReports: reports.length > 50,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
