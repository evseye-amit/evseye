import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  imports: [AuthModule],
  controllers: [InspectionsController],
  providers: [InspectionsService],
  exports: [InspectionsService],
})
export class InspectionsModule {}
