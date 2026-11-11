import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { FleetManagerHomeQueryDto } from './home.dto.js';
import { FleetManagerHomeService } from './home.service.js';

@ApiTags('Fleet Manager Home')
@ApiBearerAuth()
@Controller('fleet-manager')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.FLEET_MANAGER)
export class FleetManagerHomeController {
  constructor(
    private readonly home: FleetManagerHomeService,
    private readonly clients: ClientContextService,
  ) {}

  @Get('home')
  @ApiOperation({
    summary:
      'Selected hub, live operational summary and historical end-of-yesterday counts',
    description:
      'All data is client and assigned-hub scoped. Company includes gstin and supportNumber (null when unconfigured), including when no hub is assigned. Yesterday is Asia/Kolkata; counts are null when history does not cover that cutoff. No IoT or bay metrics.',
  })
  async get(
    @CurrentUser() user: AuthUser,
    @Query() query: FleetManagerHomeQueryDto,
  ) {
    return {
      data: await this.home.get(
        this.clients.requireClientId(user),
        user.id,
        query.hubId,
      ),
    };
  }
}
