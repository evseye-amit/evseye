import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ClientResolutionModule } from './client-resolution.module.js';
import { ClientBrandingService } from './client-branding.service.js';
import {
  PublicClientController,
  ClientBrandingController,
} from './client-branding.controller.js';
import { ClientDomainController } from './client-domain.controller.js';
@Module({
  imports: [AuthModule, MediaModule, AuditModule, ClientResolutionModule],
  controllers: [
    PublicClientController,
    ClientBrandingController,
    ClientDomainController,
  ],
  providers: [ClientBrandingService],
})
export class ClientIdentityModule {}
