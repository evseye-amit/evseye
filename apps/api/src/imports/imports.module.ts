import { Module } from '@nestjs/common';
import { ImportAuthorizationService } from './import-authorization.service.js';
import { ImportsService } from './imports.service.js';
import { ImportsController } from './imports.controller.js';

@Module({ controllers: [ImportsController], providers: [ImportAuthorizationService, ImportsService], exports: [ImportAuthorizationService, ImportsService] })
export class ImportsModule {}
