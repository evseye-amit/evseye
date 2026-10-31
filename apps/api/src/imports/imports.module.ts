import { Module } from '@nestjs/common';
import { ImportAuthorizationService } from './import-authorization.service.js';

@Module({ providers: [ImportAuthorizationService], exports: [ImportAuthorizationService] })
export class ImportsModule {}
