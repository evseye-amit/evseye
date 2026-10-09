import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClientResolutionModule } from '../client-identity/client-resolution.module.js';
import { LegalAdminController, LegalController, LegalTemplateController, PublicLegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';

@Module({
  imports: [AuthModule, ClientResolutionModule],
  controllers: [LegalController, PublicLegalController, LegalAdminController, LegalTemplateController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
