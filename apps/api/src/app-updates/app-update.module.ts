import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { ClientResolutionModule } from '../client-identity/client-resolution.module.js';
import {
  AppUpdateAdminController,
  AuthenticatedAppUpdateController,
  PublicAppUpdateController,
} from './app-update.controller.js';
import { AppUpdateInterceptor } from './app-update.interceptor.js';
import { AppUpdateService } from './app-update.service.js';

@Module({
  imports: [AuthModule, ClientResolutionModule],
  controllers: [
    AppUpdateAdminController,
    AuthenticatedAppUpdateController,
    PublicAppUpdateController,
  ],
  providers: [
    AppUpdateService,
    { provide: APP_INTERCEPTOR, useClass: AppUpdateInterceptor },
  ],
})
export class AppUpdateModule {}
