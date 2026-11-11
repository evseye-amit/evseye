import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { MaintenanceFleetsQueryDto } from './maintenance.dto.js';
import { FleetManagerMaintenanceService } from './maintenance.service.js';

@ApiTags('Fleet Manager Maintenance')
@ApiBearerAuth()
@Controller('fleet-manager/maintenance/fleets')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.FLEET_MANAGER)
export class FleetManagerMaintenanceController {
  constructor(
    private readonly maintenance: FleetManagerMaintenanceService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  @ApiOperation({
    summary: 'Paginated maintenance fleet in active assigned hubs',
    description:
      'Search affects total; summary.underMaintenance counts all maintenance fleet in the selected hub scope.',
  })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: MaintenanceFleetsQueryDto,
  ) {
    return {
      data: await this.maintenance.list(
        this.clients.requireClientId(user),
        user.id,
        query,
      ),
    };
  }
  @Get(':fleetId')
  @ApiOperation({
    summary:
      'Maintenance fleet details, recorded status history and finalized mechanic reports',
  })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('fleetId', ParseUUIDPipe) fleetId: string,
  ) {
    return {
      data: await this.maintenance.get(
        this.clients.requireClientId(user),
        user.id,
        fleetId,
      ),
    };
  }
}
