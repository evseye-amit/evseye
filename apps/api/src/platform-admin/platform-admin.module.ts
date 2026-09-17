import { ClientWelcomeService } from '../email/client-welcome.service.js';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';
import { ClientBrandingController } from './client-branding.controller.js';

@Module({
  imports: [AuthModule, AuditModule, MediaModule],
  controllers: [PlatformAdminController, ClientBrandingController],
  providers: [PlatformAdminService, ClientWelcomeService],
})
export class PlatformAdminModule {}
