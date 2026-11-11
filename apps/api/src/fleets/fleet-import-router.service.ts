import { BadRequestException, Injectable } from '@nestjs/common';
import { ImportEntityType } from '@prisma/client';
import { ComponentsService } from './components.service.js';
import { FleetsService } from './fleets.service.js';
import { IotService } from '../iot/iot.service.js';

@Injectable()
export class FleetImportRouterService {
  constructor(private readonly fleets: FleetsService, private readonly components: ComponentsService, private readonly iot: IotService) {}

  // Authorization is intentionally kept at the router boundary for component retries.

  retry(clientId: string, actorId: string, entityType: ImportEntityType, filename: string, rows: Array<Record<string, unknown>>) {
    switch (entityType) {
      case ImportEntityType.FLEET: return this.fleets.bulkCreate(clientId, actorId, filename, rows);
      case ImportEntityType.BATTERY: return this.components.bulkCreate(clientId, actorId, filename, 'BATTERY', rows);
      case ImportEntityType.CONTROLLER: return this.components.bulkCreate(clientId, actorId, filename, 'CONTROLLER', rows);
      case ImportEntityType.IOT_DEVICE: return this.iot.bulkRegisterDevices(clientId, actorId, filename, rows);
      default: throw new BadRequestException('Unsupported Fleet import entity type.');
    }
  }
}
