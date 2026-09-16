import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { LocalStorageController } from './storage/local-storage.controller.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { S3StorageProvider } from './storage/s3-storage.provider.js';
import { STORAGE_PROVIDER } from './storage/storage-provider.interface.js';
import type { Environment } from '../config/environment.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [MediaController, LocalStorageController],
  providers: [
    MediaService,
    S3StorageProvider,
    {
      provide: LocalStorageProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new LocalStorageProvider({
          root: config.getOrThrow('LOCAL_STORAGE_ROOT'),
          ttlSeconds: config.getOrThrow('S3_SIGNED_URL_TTL_SECONDS'),
        }),
    },
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, S3StorageProvider, LocalStorageProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        s3: S3StorageProvider,
        local: LocalStorageProvider,
      ) => {
        const driver = config.getOrThrow('OBJECT_STORAGE_DRIVER');
        if (driver === 's3') return s3;
        if (driver === 'local') {
          if (config.getOrThrow('NODE_ENV') === 'production') {
            throw new Error('Local object storage is disabled in production.');
          }
          return local;
        }
        throw new Error(`Unsupported OBJECT_STORAGE_DRIVER: ${driver}`);
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class MediaModule {}
