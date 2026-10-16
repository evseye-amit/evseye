import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AppNotificationController,
  ClientNotificationController,
} from './notification.controller.js';
import {
  FirebasePushProvider,
  PUSH_PROVIDER,
} from './firebase-push.provider.js';
import { NotificationService } from './notification.service.js';
import { NotificationWorker } from './notification.worker.js';
@Module({
  imports: [AuthModule],
  controllers: [AppNotificationController, ClientNotificationController],
  providers: [
    FirebasePushProvider,
    { provide: PUSH_PROVIDER, useExisting: FirebasePushProvider },
    NotificationService,
    NotificationWorker,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
