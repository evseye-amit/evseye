import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { S3StorageProvider } from './storage/s3-storage.provider.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';

@Module({
  controllers: [MediaController],
  providers: [MediaService, S3StorageProvider, { provide: STORAGE_PROVIDER, useExisting: S3StorageProvider }],
})
export class MediaModule {}
