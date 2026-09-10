import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PhotoEntityType, PhotoStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUploadIntentDto } from './dto/create-upload-intent.dto.js';
import { STORAGE_PROVIDER, type StorageProvider } from './storage/storage-provider.interface.js';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async createUploadIntent(tenantId: string, uploadedById: string, dto: CreateUploadIntentDto) {
    await this.assertEntityOwnership(tenantId, dto.entityType, dto.entityId);
    this.assertExtensionMatchesMime(dto.fileName, dto.mimeType);

    const objectKey = `tenants/${tenantId}/${dto.entityType.toLowerCase()}/${dto.entityId}/${randomUUID()}.${this.extensionFor(dto.mimeType)}`;
    const photo = await this.prisma.photo.create({
      data: {
        tenantId,
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

  async complete(tenantId: string, photoId: string) {
    const photo = await this.getPhoto(tenantId, photoId);
    if (photo.status !== PhotoStatus.PENDING_UPLOAD) {
      throw new BadRequestException('Photo is not awaiting upload completion.');
    }
    await this.storage.assertObjectExists(photo.objectKey);
    return this.prisma.photo.update({
      where: { id: photo.id },
      data: { status: PhotoStatus.COMPLETE, uploadedAt: new Date() },
    });
  }

  async downloadUrl(tenantId: string, photoId: string) {
    const photo = await this.getPhoto(tenantId, photoId);
    if (photo.status !== PhotoStatus.COMPLETE) {
      throw new BadRequestException('Photo is not available.');
    }
    return { url: await this.storage.createDownloadUrl(photo.objectKey) };
  }

  private async getPhoto(tenantId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, tenantId } });
    if (!photo) {
      throw new NotFoundException('Photo not found.');
    }
    return photo;
  }

  private async assertEntityOwnership(tenantId: string, entityType: PhotoEntityType, entityId: string) {
    if (entityType === PhotoEntityType.RIDER) {
      const rider = await this.prisma.rider.findFirst({ where: { id: entityId, tenantId, deletedAt: null } });
      if (rider) return;
    }
    if (entityType === PhotoEntityType.FLEET) {
      const fleet = await this.prisma.fleet.findFirst({ where: { id: entityId, tenantId, deletedAt: null } });
      if (fleet) return;
    }
    throw new NotFoundException('Media entity not found.');
  }

  private assertExtensionMatchesMime(fileName: string, mimeType: string) {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension || extension !== this.extensionFor(mimeType)) {
      throw new BadRequestException('File extension does not match its MIME type.');
    }
  }

  private extensionFor(mimeType: string): string {
    return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimeType] ?? 'invalid';
  }
}
