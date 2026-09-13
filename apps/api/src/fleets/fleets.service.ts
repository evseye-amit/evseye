import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientOnboardingStep,
  ClientOnboardingStepStatus,
  ClientStatus,
  ImportEntityType,
  ImportStatus,
  PhotoEntityType,
  PhotoStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateFleetDto } from './dto/create-fleet.dto.js';
import type { ListFleetsDto } from './dto/list-fleets.dto.js';
import { FleetStatusPolicy } from './fleet-status.policy.js';

@Injectable()
export class FleetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusPolicy: FleetStatusPolicy,
  ) {}
  async create(clientId: string, dto: CreateFleetDto) {
    if (
      dto.homeHubId &&
      !(await this.prisma.hub.findFirst({
        where: { id: dto.homeHubId, clientId, deletedAt: null },
      }))
    )
      throw new NotFoundException('Hub not found.');
    if (
      dto.currentHubId &&
      !(await this.prisma.hub.findFirst({
        where: { id: dto.currentHubId, clientId, deletedAt: null },
      }))
    )
      throw new NotFoundException('Current hub not found.');
    try {
      const fleet = await this.prisma.fleet.create({
        data: {
          ...dto,
          clientId,
          currentHubId: dto.currentHubId ?? dto.homeHubId,
          registrationDate: dto.registrationDate
            ? new Date(dto.registrationDate)
            : undefined,
          insuranceStartDate: dto.insuranceStartDate
            ? new Date(dto.insuranceStartDate)
            : undefined,
          insuranceEndDate: dto.insuranceEndDate
            ? new Date(dto.insuranceEndDate)
            : undefined,
          fitnessRenewalDate: dto.fitnessRenewalDate
            ? new Date(dto.fitnessRenewalDate)
            : undefined,
        },
      });
      await this.completeOnboardingStep(clientId);
      return fleet;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Vehicle number or chassis number already exists in this client.',
        );
      throw error;
    }
  }
  async bulkCreate(
    clientId: string,
    actorId: string,
    filename: string,
    rows: CreateFleetDto[],
  ) {
    const failures: Array<
      CreateFleetDto & {
        row_number: number;
        failure_reason: string;
        failure_fields: string;
      }
    > = [];
    const vehicleNumbers = new Set<string>();
    const chassisNumbers = new Set<string>();
    let created = 0;
    for (const [index, row] of rows.entries()) {
      const vehicleNumber = row.vehicleNumber?.trim().toUpperCase();
      const chassisNumber = row.chassisNumber?.trim().toUpperCase();
      if (
        vehicleNumbers.has(vehicleNumber) ||
        chassisNumbers.has(chassisNumber)
      ) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            'Duplicate vehicle number or chassis number in upload.',
          failure_fields: 'vehicleNumber,chassisNumber',
        });
        continue;
      }
      vehicleNumbers.add(vehicleNumber);
      chassisNumbers.add(chassisNumber);
      try {
        await this.create(clientId, { ...row, vehicleNumber, chassisNumber });
        created += 1;
      } catch (error) {
        failures.push({
          ...row,
          row_number: index + 2,
          failure_reason:
            error instanceof Error ? error.message : 'Invalid row.',
          failure_fields: 'vehicleNumber,chassisNumber,homeHubId,currentHubId',
        });
      }
    }
    const status = !created
      ? ImportStatus.FAIL
      : failures.length
        ? ImportStatus.PARTIAL_PASS
        : ImportStatus.PASS;
    const job = await this.prisma.importJob.create({
      data: {
        clientId,
        entityType: ImportEntityType.FLEET,
        status,
        originalFilename: filename,
        totalRows: rows.length,
        passedRows: created,
        failedRows: failures.length,
        duplicateRows: failures.filter((row) =>
          row.failure_reason.startsWith('Duplicate'),
        ).length,
        createdRows: created,
        createdById: actorId,
        completedAt: new Date(),
        metadata: JSON.parse(JSON.stringify({ failures })),
      },
    });
    if (created) await this.completeOnboardingStep(clientId);
    return {
      jobId: job.id,
      status,
      totalRows: rows.length,
      passedRows: created,
      failedRows: failures.length,
      createdRows: created,
    };
  }
  async failedRows(clientId: string, jobId: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, clientId, entityType: ImportEntityType.FLEET },
      select: { metadata: true },
    });
    if (!job) throw new NotFoundException('Import job not found.');
    return (job.metadata as { failures?: unknown[] } | null)?.failures ?? [];
  }
  private async completeOnboardingStep(clientId: string) {
    const progress = await this.prisma.clientOnboardingProgress.findUnique({
      where: { clientId },
      include: { client: { select: { status: true } } },
    });
    if (
      !progress ||
      progress.client.status !== ClientStatus.CREATED ||
      progress.currentStep !== ClientOnboardingStep.FLEETS
    )
      return;
    await this.prisma.$transaction([
      this.prisma.clientOnboardingStepRecord.updateMany({
        where: { progressId: progress.id, step: ClientOnboardingStep.FLEETS },
        data: {
          status: ClientOnboardingStepStatus.COMPLETED,
          savedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      this.prisma.clientOnboardingProgress.update({
        where: { id: progress.id },
        data: { currentStep: ClientOnboardingStep.RIDERS },
      }),
    ]);
  }
  async list(clientId: string, query: ListFleetsDto) {
    const where = {
      clientId,
      deletedAt: null,
      ...(query.status
        ? { status: query.status as import('@prisma/client').FleetStatus }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                vehicleNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                chassisNumber: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              { oem: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fleet.findMany({
        where,
        include: { homeHub: true, currentHub: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fleet.count({ where }),
    ]);
    return {
      items,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }
  async get(clientId: string, id: string) {
    const fleet = await this.prisma.fleet.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        homeHub: true,
        currentHub: true,
        batteries: true,
        controllers: true,
      },
    });
    if (!fleet) throw new NotFoundException('Fleet not found.');
    return fleet;
  }
  async onboardingStatus(clientId: string, id: string) {
    const fleet = await this.get(clientId, id);
    const entities = [
      {
        entityType: PhotoEntityType.FLEET,
        entityId: fleet.id,
        label: fleet.vehicleNumber,
      },
      ...fleet.batteries.map((battery) => ({
        entityType: PhotoEntityType.BATTERY,
        entityId: battery.id,
        label: battery.serialNumber,
      })),
      ...fleet.controllers.map((controller) => ({
        entityType: PhotoEntityType.CONTROLLER,
        entityId: controller.id,
        label: controller.serialNumber,
      })),
    ];
    const entityTypes = [
      PhotoEntityType.FLEET,
      PhotoEntityType.BATTERY,
      PhotoEntityType.CONTROLLER,
    ];
    const [requirements, completedPhotos] = await Promise.all([
      this.prisma.photoRequirement.findMany({
        where: { clientId, entityType: { in: entityTypes }, isRequired: true },
        select: { entityType: true, photoType: true },
      }),
      this.prisma.photo.findMany({
        where: {
          clientId,
          entityType: { in: entityTypes },
          entityId: { in: entities.map((entity) => entity.entityId) },
          status: PhotoStatus.COMPLETE,
        },
        select: { entityType: true, entityId: true, photoType: true },
      }),
    ]);
    const items = entities.map((entity) => {
      const requiredPhotoTypes = requirements
        .filter((requirement) => requirement.entityType === entity.entityType)
        .map((requirement) => requirement.photoType);
      const completedPhotoTypes = completedPhotos
        .filter(
          (photo) =>
            photo.entityType === entity.entityType &&
            photo.entityId === entity.entityId,
        )
        .map((photo) => photo.photoType);
      const completed = new Set(completedPhotoTypes);
      const missingPhotoTypes = requiredPhotoTypes.filter(
        (photoType) => !completed.has(photoType),
      );
      return {
        ...entity,
        requiredPhotoTypes,
        completedPhotoTypes,
        missingPhotoTypes,
        ready: missingPhotoTypes.length === 0,
      };
    });
    return { ready: items.every((item) => item.ready), items };
  }
  async currentState(clientId: string, id: string) {
    await this.get(clientId, id);
    return this.prisma.vehicleCurrentState.findFirst({
      where: { clientId, fleetId: id },
    });
  }
  async changeStatus(
    clientId: string,
    id: string,
    status: Parameters<FleetStatusPolicy['assertTransition']>[1],
  ) {
    const fleet = await this.get(clientId, id);
    this.statusPolicy.assertTransition(fleet.status, status);
    return this.prisma.fleet.update({ where: { id }, data: { status } });
  }
}
