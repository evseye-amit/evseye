import { fleetManagerVisibleSubjects } from '../rider-access/rider-hub-policy.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoEntityType, PhotoStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from './storage/storage-provider.interface.js';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async createUploadIntent(
    clientId: string,
    uploadedById: string,
    dto: CreateUploadIntentDto,
  ) {
    if ((dto.entityType as string) === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.createUploadIntentForEntity(
      clientId,
      uploadedById,
      dto.entityType,
      dto.entityId,
      dto.photoType,
      dto,
    );
  }

  async createSupportUploadIntent(
    clientId: string,
    uploadedById: string,
    ticketId: string,
    dto: Omit<CreateUploadIntentDto, 'entityType' | 'entityId'>,
  ) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, clientId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    return this.createUploadIntentForEntity(
      clientId,
      uploadedById,
      PhotoEntityType.SUPPORT_TICKET,
      ticketId,
      dto.photoType,
      dto,
    );
  }

  private async createUploadIntentForEntity(
    clientId: string,
    uploadedById: string,
    entityType: PhotoEntityType,
    entityId: string,
    photoType: string,
    dto: Omit<CreateUploadIntentDto, 'entityType' | 'entityId'>,
  ) {
    await this.assertEntityOwnership(clientId, entityType, entityId);
    this.assertExtensionMatchesMime(dto.fileName, dto.mimeType);

    const objectKey = `clients/${clientId}/${entityType.toLowerCase()}/${entityId}/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    const photo = await this.prisma.photo.create({
      data: {
        clientId,
        entityType,
        entityId,
        photoType,
        objectKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedById,
      },
    });
    const uploadUrl = await this.storage.createUploadUrl({
      objectKey,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });

    return { photo, uploadUrl };
  }

  async requirements(clientId: string, entityType: PhotoEntityType) {
    if (entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.prisma.photoRequirement.findMany({
      where: { clientId, entityType },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  }

  async listEntityPhotos(
    clientId: string,
    entityType: PhotoEntityType,
    entityId: string,
    actor?: AuthUser,
  ) {
    if (entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    await this.assertEntityOwnership(clientId, entityType, entityId);
    await this.assertFleetManagerEntityAccess(
      clientId,
      actor,
      entityType,
      entityId,
    );
    return this.prisma.photo.findMany({
      where: { clientId, entityType, entityId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async upsertRequirement(
    clientId: string,
    entityType: PhotoEntityType,
    photoType: string,
    input: { isRequired: boolean; sortOrder?: number },
  ) {
    if (entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.prisma.photoRequirement.upsert({
      where: {
        clientId_entityType_photoType: { clientId, entityType, photoType },
      },
      create: {
        clientId,
        entityType,
        photoType,
        isRequired: input.isRequired,
        sortOrder: input.sortOrder ?? 0,
      },
      update: {
        isRequired: input.isRequired,
        ...(input.sortOrder === undefined
          ? {}
          : { sortOrder: input.sortOrder }),
      },
    });
  }

  async complete(clientId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (photo.entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.completePhoto(clientId, photo);
  }

  async completeSupport(clientId: string, ticketId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
    if (
      photo.entityType !== PhotoEntityType.SUPPORT_TICKET ||
      photo.entityId !== ticketId
    )
      throw new NotFoundException('Support attachment not found.');
    return this.completePhoto(clientId, photo);
  }

  private async completePhoto(
    clientId: string,
    photo: Awaited<ReturnType<MediaService['getPhoto']>>,
  ) {
    if (photo.status !== PhotoStatus.PENDING_UPLOAD) {
      throw new BadRequestException('Photo is not awaiting upload completion.');
    }
    await this.storage.assertObjectExists(photo.objectKey);
    // A new upload for a completed slot is a replacement, rather than another
    // active image for the same fleet/component photo type. Keeping prior
    // objects as DELETED retains an audit trail without letting stale evidence
    // satisfy the onboarding requirement.
    return this.prisma.$transaction(async (tx) => {
      await tx.photo.updateMany({
        where: {
          clientId,
          entityType: photo.entityType,
          entityId: photo.entityId,
          photoType: photo.photoType,
          status: PhotoStatus.COMPLETE,
          id: { not: photo.id },
        },
        data: { status: PhotoStatus.DELETED },
      });
      return tx.photo.update({
        where: { id: photo.id },
        data: { status: PhotoStatus.COMPLETE, uploadedAt: new Date() },
      });
    });
  }

  async downloadUrl(clientId: string, photoId: string, actor?: AuthUser) {
    const photo = await this.getPhoto(clientId, photoId);
    await this.assertFleetManagerPhotoAccess(clientId, actor, photo);
    if (photo.entityType === PhotoEntityType.SUPPORT_TICKET)
      throw new ForbiddenException(
        'Support attachments use the support ticket routes.',
      );
    return this.downloadPhoto(photo);
  }

  async supportDownloadUrl(
    clientId: string,
    ticketId: string,
    photoId: string,
  ) {
    const photo = await this.getPhoto(clientId, photoId);
    if (
      photo.entityType !== PhotoEntityType.SUPPORT_TICKET ||
      photo.entityId !== ticketId
    )
      throw new NotFoundException('Support attachment not found.');
    return this.downloadPhoto(photo);
  }

  private async downloadPhoto(
    photo: Awaited<ReturnType<MediaService['getPhoto']>>,
  ) {
    if (photo.status !== PhotoStatus.COMPLETE) {
      throw new BadRequestException('Photo is not available.');
    }
    return { url: await this.storage.createDownloadUrl(photo.objectKey) };
  }

  private async getPhoto(clientId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, clientId },
    });
    if (!photo) {
      throw new NotFoundException('Photo not found.');
    }
    return photo;
  }

  private fleetScoped(actor?: AuthUser) {
    return Boolean(
      actor?.roles.includes(UserRole.FLEET_MANAGER) &&
      !actor.roles.some(
        (role) =>
          role === UserRole.CLIENT_ADMIN ||
          role === UserRole.OPERATIONS_MANAGER ||
          role === UserRole.KYC_OPERATOR,
      ),
    );
  }

  private async assertFleetManagerEntityAccess(
    clientId: string,
    actor: AuthUser | undefined,
    entityType: PhotoEntityType,
    entityId: string,
  ) {
    if (!actor || !this.fleetScoped(actor)) return;
    if (
      entityType !== PhotoEntityType.RIDER &&
      entityType !== PhotoEntityType.RIDER_ONBOARDING
    )
      return;
    const visible = await fleetManagerVisibleSubjects(
      this.prisma,
      clientId,
      actor.id,
    );
    const allowed =
      entityType === PhotoEntityType.RIDER
        ? visible.riderIds.includes(entityId)
        : await this.visibleOnboardingProgress(
            clientId,
            entityId,
            visible.userIds,
          );
    if (!allowed) throw new NotFoundException('Media entity not found.');
  }

  private async visibleOnboardingProgress(
    clientId: string,
    progressId: string,
    userIds: string[],
  ) {
    if (!userIds.length) return false;
    return !!(await this.prisma.riderOnboardingProgress.findFirst({
      where: { id: progressId, clientId, userId: { in: userIds } },
      select: { id: true },
    }));
  }

  private async assertFleetManagerPhotoAccess(
    clientId: string,
    actor: AuthUser | undefined,
    photo: { entityType: PhotoEntityType; entityId: string; id: string },
  ) {
    if (!actor || !this.fleetScoped(actor)) return;
    // Vehicle/inspection access remains outside this MVP rider visibility change.
    if (
      photo.entityType !== PhotoEntityType.RIDER &&
      photo.entityType !== PhotoEntityType.RIDER_ONBOARDING
    )
      throw new NotFoundException('Photo not found.');
    try {
      await this.assertFleetManagerEntityAccess(
        clientId,
        actor,
        photo.entityType,
        photo.entityId,
      );
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new NotFoundException('Photo not found.');
      throw error;
    }
  }

  private async assertEntityOwnership(
    clientId: string,
    entityType: PhotoEntityType,
    entityId: string,
  ) {
    if (entityType === PhotoEntityType.RIDER) {
      const rider = await this.prisma.rider.findFirst({
        where: { id: entityId, clientId, deletedAt: null },
      });
      if (rider) return;
    }
    if (entityType === PhotoEntityType.RIDER_ONBOARDING) {
      const progress = await this.prisma.riderOnboardingProgress.findFirst({
        where: { id: entityId, clientId },
      });
      if (progress) return;
    }
    if (entityType === PhotoEntityType.FLEET) {
      const fleet = await this.prisma.fleet.findFirst({
        where: { id: entityId, clientId, deletedAt: null },
      });
      if (fleet) return;
    }
    if (entityType === PhotoEntityType.BATTERY) {
      const battery = await this.prisma.battery.findFirst({
        where: { id: entityId, clientId },
      });
      if (battery) return;
    }
    if (entityType === PhotoEntityType.CONTROLLER) {
      const controller = await this.prisma.controller.findFirst({
        where: { id: entityId, clientId },
      });
      if (controller) return;
    }
    if (entityType === PhotoEntityType.IOT_DEVICE) {
      const device = await this.prisma.ioTDevice.findFirst({
        where: { id: entityId, clientId },
      });
      if (device) return;
    }
    if (entityType === PhotoEntityType.INSPECTION) {
      const inspection = await this.prisma.inspection.findFirst({
        where: { id: entityId, clientId },
      });
      if (inspection) return;
    }
    if (entityType === PhotoEntityType.SUPPORT_TICKET) {
      const ticket = await this.prisma.supportTicket.findFirst({
        where: { id: entityId, clientId },
      });
      if (ticket) return;
    }
    throw new NotFoundException('Media entity not found.');
  }

  private assertExtensionMatchesMime(fileName: string, mimeType: string) {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension || extension !== this.extensionFor(mimeType)) {
      throw new BadRequestException(
        'File extension does not match its MIME type.',
      );
    }
  }

  private extensionFor(mimeType: string): string {
    return (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
      }[mimeType] ?? 'invalid'
    );
  }
}
