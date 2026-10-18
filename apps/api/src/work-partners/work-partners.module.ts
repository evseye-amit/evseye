import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ClientWorkPartnersController } from './client-work-partners.controller.js';
import { PlatformWorkPartnersController } from './platform-work-partners.controller.js';
import { WorkPartnersService } from './work-partners.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PlatformWorkPartnersController, ClientWorkPartnersController],
  providers: [WorkPartnersService],
  exports: [WorkPartnersService],
})
export class WorkPartnersModule {}
