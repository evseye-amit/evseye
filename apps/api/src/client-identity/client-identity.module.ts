import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ClientResolutionModule } from './client-resolution.module.js';
import { ClientBrandingService } from './client-branding.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { ClientBrandingController } from './client-branding.controller.js';
import { PublicClientContextController } from './public-client-context.controller.js';
import { ClientDomainController } from './client-domain.controller.js';
import { PublicPreLoginController } from './pre-login.controller.js';
import { PreLoginService } from './pre-login.service.js';
@Module({
  imports: [
    AuthModule,
    MediaModule,
    AuditModule,
    ClientResolutionModule,
    WorkflowModule,
  ],
  controllers: [
    PublicClientContextController,
    ClientBrandingController,
    ClientDomainController,
    PublicPreLoginController,
  ],
  providers: [ClientBrandingService, PreLoginService],
})
export class ClientIdentityModule {}
