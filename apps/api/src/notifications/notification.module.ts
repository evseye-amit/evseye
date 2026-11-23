import { NotificationCatalogAdminController } from './notification-catalog-admin.controller.js';
import { NotificationCatalogAdminService } from './notification-catalog-admin.service.js';
import { NotificationTopicService } from './notification-topic.service.js';
import { NotificationTopicWorker } from './notification-topic.worker.js';
import {
  NotificationTopicController,
  NotificationSubscriptionController,
} from './notification-topic.controller.js';
import { NotificationInstallationController } from './notification-installation.controller.js';
import { NotificationInstallationService } from './notification-installation.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
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
import { NotificationCatalogService } from './notification-catalog.service.js';
import { NotificationCatalogController } from './notification-catalog.controller.js';
import { NotificationConfigurationService } from './notification-configuration.service.js';
import { NotificationConfigurationController } from './notification-configuration.controller.js';
@Module({
  imports: [AuthModule],
  controllers: [
    NotificationCatalogAdminController,
    NotificationTopicController,
    NotificationSubscriptionController,
    NotificationInstallationController,
    NotificationPreferencesController,
    AppNotificationController,
    ClientNotificationController,
    NotificationCatalogController,
    NotificationConfigurationController,
  ],
  providers: [
    NotificationCatalogAdminService,
    NotificationTopicService,
    NotificationTopicWorker,
    NotificationInstallationService,
    NotificationPreferencesService,
    NotificationCatalogService,
    NotificationConfigurationService,
    FirebasePushProvider,
    { provide: PUSH_PROVIDER, useExisting: FirebasePushProvider },
    NotificationService,
    NotificationWorker,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
