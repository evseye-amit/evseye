import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationModule } from '../notifications/notification.module.js';
import { SubmissionPenaltyService } from './submission-penalty.service.js';
import { SubmissionPenaltyWorker } from './submission-penalty.worker.js';
import {
  RiderSubmissionPenaltyController,
  SubmissionPenaltyOperationsController,
} from './submission-penalty.controller.js';
@Module({
  imports: [AuthModule, NotificationModule],
  providers: [SubmissionPenaltyService, SubmissionPenaltyWorker],
  controllers: [
    RiderSubmissionPenaltyController,
    SubmissionPenaltyOperationsController,
  ],
  exports: [SubmissionPenaltyService],
})
export class SubmissionPenaltyModule {}
