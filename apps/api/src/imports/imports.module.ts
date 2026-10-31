import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ImportAuthorizationService } from './import-authorization.service.js';
import { ImportsService } from './imports.service.js';
import { ImportsController } from './imports.controller.js';

@Module({ imports: [AuthModule], controllers: [ImportsController], providers: [ImportAuthorizationService, ImportsService], exports: [ImportAuthorizationService, ImportsService] })
export class ImportsModule {}
