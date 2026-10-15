import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationStatus,
  InspectionStatus,
  PhotoEntityType,
  PhotoStatus,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto.js';
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocations: AllocationsService,
  ) {}
  async get(clientId: string, inspectionId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, clientId },
      include: { allocation: { include: { rider: true, fleet: true } } },
    });
    if (!inspection) throw new NotFoundException('Inspection not found.');
    const photos = await this.prisma.photo.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.INSPECTION,
        entityId: inspectionId,
      },
      orderBy: { uploadedAt: 'asc' },
    });
    return { ...inspection, photos };
  }

  async complete(
    clientId: string,
    inspectionId: string,
    actor: AuthUser,
    input?: CompleteInspectionDto,
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, clientId },
      include: { allocation: true },
    });
    if (!inspection) throw new NotFoundException('Inspection not found.');
    if (inspection.status !== InspectionStatus.DRAFT) {
      throw new ConflictException('Inspection has already been completed.');
    }
    const required = await this.prisma.photoRequirement.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.INSPECTION,
        isRequired: true,
      },
    });
    const complete = await this.prisma.photo.findMany({
      where: {
        clientId,
        entityType: PhotoEntityType.INSPECTION,
        entityId: inspectionId,
        status: PhotoStatus.COMPLETE,
      },
      select: { photoType: true },
    });
    const types = new Set(complete.map((p) => p.photoType));
    const missing = required
      .filter((r) => !types.has(r.photoType))
      .map((r) => r.photoType);
    if (missing.length)
      throw new BadRequestException({
        message: 'Required inspection photos are missing.',
        missing,
      });
    if (inspection.type === 'POST_DEALLOCATION') {
      if (typeof input?.safeForReuse !== 'boolean')
        throw new BadRequestException({
          code: 'SAFE_FOR_REUSE_REQUIRED',
          message: 'safeForReuse is required for a return inspection.',
        });
      if (!input.safeForReuse && !input.unsafeReason?.trim())
        throw new BadRequestException({
          code: 'UNSAFE_REASON_REQUIRED',
          message: 'unsafeReason is required when the vehicle is unsafe.',
        });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id: inspectionId },
        data: {
          status: InspectionStatus.COMPLETED,
          completedBy: actor.id,
          completedAt: new Date(),
          ...(inspection.type === 'POST_DEALLOCATION'
            ? {
                safeForReuse: input!.safeForReuse,
                unsafeReason: input!.safeForReuse
                  ? null
                  : input!.unsafeReason!.trim(),
              }
            : {}),
        },
      });
      if (
        actor.roles.includes(UserRole.FLEET_MANAGER) &&
        !actor.roles.some(
          (role) =>
            role === UserRole.CLIENT_ADMIN || role === UserRole.OPERATIONS_MANAGER,
        )
      ) {
        const hubs = (
          await tx.userHub.findMany({
            where: { clientId, userId: actor.id },
            select: { hubId: true },
          })
        ).map((row) => row.hubId);
        const scoped = await tx.allocation.findFirst({
          where: {
            id: inspection.allocationId,
            clientId,
            fleet: { currentHubId: { in: hubs } },
          },
          select: { id: true },
        });
        if (!scoped) throw new NotFoundException('Inspection is not in an assigned Hub.');
      }
      let receivedReturnFinalized = false;
      if (inspection.type === 'POST_DEALLOCATION') {
        const receivedReturn = await tx.rentalTerminationRequest.findFirst({
          where: {
            clientId,
            allocationId: inspection.allocationId,
            status: 'RETURNED',
          },
          select: { id: true },
        });
        if (receivedReturn) {
          await this.allocations.completeDeallocationInTransaction(
            tx,
            clientId,
            inspection.allocationId,
          );
          receivedReturnFinalized = true;
        }
      }
      if (!receivedReturnFinalized && inspection.allocation.status === AllocationStatus.INSPECTION_PENDING)
        await tx.allocation.update({
          where: { id: inspection.allocationId },
          data: { status: AllocationStatus.OTP_PENDING },
        });
      return updated;
    });
  }
}
