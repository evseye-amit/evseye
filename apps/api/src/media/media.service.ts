import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
    await this.assertEntityOwnership(clientId, dto.entityType, dto.entityId);
    this.assertExtensionMatchesMime(dto.fileName, dto.mimeType);

    const objectKey = `clients/${clientId}/${dto.entityType.toLowerCase()}/${dto.entityId}/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    const photo = await this.prisma.photo.create({
      data: {
        clientId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        photoType: dto.photoType,
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
    return this.prisma.photoRequirement.findMany({
      where: { clientId, entityType },
      orderBy: [{ isRequired: 'desc' }, { photoType: 'asc' }],
    });
  }

  async listEntityPhotos(
    clientId: string,
    entityType: PhotoEntityType,
    entityId: string,
  ) {
    await this.assertEntityOwnership(clientId, entityType, entityId);
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

  async downloadUrl(clientId: string, photoId: string) {
    const photo = await this.getPhoto(clientId, photoId);
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
    if (entityType === PhotoEntityType.INSPECTION) {
      const inspection = await this.prisma.inspection.findFirst({
        where: { id: entityId, clientId },
      });
      if (inspection) return;
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
      { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
        mimeType
      ] ?? 'invalid'
    );
  }
}
