import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  FleetStatus,
  InspectionStatus,
  InspectionType,
  PhotoEntityType,
  PhotoStatus,
  Prisma,
  RiderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListAllocationsDto } from './dto/list-allocations.dto.js';

@Injectable()
export class AllocationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(clientId: string, query: ListAllocationsDto, hubIds?: string[]) {
    const where = {
      clientId,
      ...(hubIds ? { fleet: { currentHubId: { in: hubIds } } } : {}),
      ...(query.status ? { status: query.status as AllocationStatus } : {}),
      ...(query.riderId ? { riderId: query.riderId } : {}),
      ...(query.fleetId ? { fleetId: query.fleetId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                fleet: {
                  vehicleNumber: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                rider: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              { rider: { mobile: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.allocation.findMany({
        where,
        include: {
          rider: true,
          fleet: { include: { currentHub: true } },
          inspections: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.allocation.count({ where }),
    ]);
    return {
      items,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(clientId: string, allocationId: string, hubIds?: string[]) {
    const allocation = await this.prisma.allocation.findFirst({
      where: { id: allocationId, clientId, ...(hubIds ? { fleet: { currentHubId: { in: hubIds } } } : {}) },
      include: {
        rider: true,
        fleet: { include: { currentHub: true } },
        inspections: true,
      },
    });
    if (!allocation) throw new NotFoundException('Allocation not found.');
    return allocation;
  }

  async fleetManagerHubIds(clientId: string, userId: string) {
    return (await this.prisma.userHub.findMany({ where: { clientId, userId }, select: { hubId: true } })).map((entry) => entry.hubId);
  }
  async assertFleetManagerFleet(clientId: string, userId: string, fleetId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const fleet = await this.prisma.fleet.findFirst({ where: { id: fleetId, clientId, currentHubId: { in: hubIds }, deletedAt: null }, select: { id: true } });
    if (!fleet) throw new NotFoundException('Fleet not found in an assigned Hub.');
    return hubIds;
  }
  async assertFleetManagerAllocation(clientId: string, userId: string, allocationId: string) {
    const hubIds = await this.fleetManagerHubIds(clientId, userId);
    const allocation = await this.prisma.allocation.findFirst({ where: { id: allocationId, clientId, fleet: { currentHubId: { in: hubIds } } }, select: { id: true } });
    if (!allocation) throw new NotFoundException('Allocation not found in an assigned Hub.');
    return hubIds;
  }
  async initiate(
    clientId: string,
    fleetId: string,
    riderId: string,
    actorId: string,
    idempotencyKey?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const rider = await tx.rider.findFirst({
        where: { id: riderId, clientId, deletedAt: null },
      });
      if (!rider) throw new NotFoundException('Rider not found.');
      if (rider.status !== RiderStatus.ACTIVE) {
        throw new ConflictException('Rider must be active before allocation.');
      }
      const reserved = await tx.fleet.updateMany({
        where: {
          id: fleetId,
          clientId,
          status: FleetStatus.AVAILABLE,
          deletedAt: null,
        },
        data: { status: FleetStatus.RESERVED },
      });
      if (reserved.count !== 1)
        throw new ConflictException('Fleet is not available for allocation.');
      await this.assertRequiredFleetPhotos(tx, clientId, fleetId);
      const allocation = await tx.allocation.create({
        data: {
          clientId,
          fleetId,
          riderId,
          initiatedById: actorId,
          idempotencyKey,
          status: 'INSPECTION_PENDING',
        },
      });
      await tx.inspection.create({
        data: {
          clientId,
          allocationId: allocation.id,
          type: InspectionType.PRE_ALLOCATION,
          status: InspectionStatus.DRAFT,
        },
      });
      await tx.mobileDeploymentWorkflow.create({
        data: { clientId, allocationId: allocation.id, status: 'RIDER_WAITING' },
      });
      return allocation;
    });
  }

  private async assertRequiredFleetPhotos(
    tx: Prisma.TransactionClient,
    clientId: string,
    fleetId: string,
  ) {
    const requirements = await tx.photoRequirement.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.FLEET,
        isRequired: true,
      },
      select: { photoType: true },
    });
    if (requirements.length === 0) return;

    const completedPhotos = await tx.photo.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.FLEET,
        entityId: fleetId,
        status: PhotoStatus.COMPLETE,
        photoType: {
          in: requirements.map((requirement) => requirement.photoType),
        },
      },
      select: { photoType: true },
    });
    const completeTypes = new Set(
      completedPhotos.map((photo) => photo.photoType),
    );
    const missing = requirements
      .map((requirement) => requirement.photoType)
      .filter((photoType) => !completeTypes.has(photoType));
    if (missing.length > 0) {
      throw new ConflictException(
        `Fleet onboarding photos are incomplete: ${missing.join(', ')}.`,
      );
    }
  }
  async activate(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.allocation.findFirst({
        where: {
          id: allocationId,
          clientId,
          status: AllocationStatus.OTP_PENDING,
        },
      });
      if (!allocation)
        throw new NotFoundException(
          'Allocation awaiting activation not found.',
        );

      const inspection = await tx.inspection.findFirst({
        where: {
          clientId,
          allocationId,
          type: InspectionType.PRE_ALLOCATION,
          status: InspectionStatus.COMPLETED,
        },
      });
      if (!inspection)
        throw new ConflictException('Pre-allocation inspection is incomplete.');

      const activated = await tx.allocation.updateMany({
        where: {
          id: allocationId,
          clientId,
          status: AllocationStatus.OTP_PENDING,
        },
        data: { status: AllocationStatus.ACTIVE, allocatedAt: new Date() },
      });
      if (activated.count !== 1)
        throw new ConflictException(
          'Allocation state changed; retry the request.',
        );

      const fleet = await tx.fleet.updateMany({
        where: {
          id: allocation.fleetId,
          clientId,
          status: FleetStatus.RESERVED,
          deletedAt: null,
        },
        data: { status: FleetStatus.ALLOCATED },
      });
      if (fleet.count !== 1)
        throw new ConflictException(
          'Fleet is not reserved for this allocation.',
        );

      return { activated: true, allocationId };
    });
  }
  async initiateDeallocation(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.allocation.findFirst({
        where: { id: allocationId, clientId, status: AllocationStatus.ACTIVE },
      });
      if (!allocation)
        throw new NotFoundException('Active allocation not found.');
      await tx.allocation.update({
        where: { id: allocation.id },
        data: { status: AllocationStatus.DEALLOCATION_INITIATED },
      });
      await tx.fleet.updateMany({
        where: {
          id: allocation.fleetId,
          clientId,
          status: { in: [FleetStatus.ALLOCATED, FleetStatus.IN_USE] },
        },
        data: { status: FleetStatus.DEALLOCATION_IN_PROGRESS },
      });
      const inspection = await tx.inspection.upsert({
        where: {
          allocationId_type: {
            allocationId: allocation.id,
            type: InspectionType.POST_DEALLOCATION,
          },
        },
        create: {
          clientId,
          allocationId: allocation.id,
          type: InspectionType.POST_DEALLOCATION,
          status: InspectionStatus.DRAFT,
        },
        update: {},
      });
      return { allocationId: allocation.id, inspectionId: inspection.id };
    });
  }
  async completeDeallocation(clientId: string, allocationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.allocation.findFirst({
        where: {
          id: allocationId,
          clientId,
          status: AllocationStatus.DEALLOCATION_INITIATED,
        },
      });
      if (!a) throw new NotFoundException('Deallocation not found.');
      const inspection = await tx.inspection.findFirst({
        where: {
          allocationId,
          type: InspectionType.POST_DEALLOCATION,
          status: InspectionStatus.COMPLETED,
        },
      });
      if (!inspection)
        throw new ConflictException(
          'Post-deallocation inspection is incomplete.',
        );
      const otps = await tx.otpRequest.findMany({
        where: {
          clientId,
          status: 'VERIFIED',
          purpose: { in: ['DEALLOCATION_RIDER', 'DEALLOCATION_OPERATOR'] },
        },
      });
      const purposes = new Set(
        otps
          .filter(
            (o) =>
              (o.context as { allocationId?: string } | null)?.allocationId ===
              allocationId,
          )
          .map((o) => o.purpose),
      );
      if (
        !purposes.has('DEALLOCATION_RIDER') ||
        !purposes.has('DEALLOCATION_OPERATOR')
      )
        throw new ConflictException('Both deallocation OTPs must be verified.');
      await tx.allocation.update({
        where: { id: allocationId },
        data: { status: AllocationStatus.COMPLETED, deallocatedAt: new Date() },
      });
      await tx.fleet.update({
        where: { id: a.fleetId },
        data: { status: FleetStatus.AVAILABLE },
      });
      return { completed: true };
    });
  }
}
