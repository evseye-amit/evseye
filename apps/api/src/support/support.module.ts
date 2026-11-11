import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { SupportController, RiderSupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [SupportController, RiderSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
