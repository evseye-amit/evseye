import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformCatalogController } from './platform-catalog.controller.js';
import { PlatformCatalogService } from './platform-catalog.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PlatformCatalogController],
  providers: [PlatformCatalogService],
})
export class PlatformCatalogModule {}
