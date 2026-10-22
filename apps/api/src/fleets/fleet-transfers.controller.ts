import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { FleetsService } from './fleets.service.js';

@Controller('fleet-transfers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class FleetTransfersController {
  constructor(
    private readonly fleets: FleetsService,
    private readonly clients: ClientContextService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/receipt') async receipt(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    const result = await this.fleets.receiveTransfer(clientId, id, u);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'FLEET_TRANSFER_RECEIVED',
      entityType: 'FLEET',
      entityId: result.fleet.id,
      newData: { transferId: id, currentHubId: result.fleet.currentHubId },
    });
    return { data: result };
  }
}
