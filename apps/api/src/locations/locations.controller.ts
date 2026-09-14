import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CreateHubDto } from './dto/create-hub.dto.js';
import { LocationsService } from './locations.service.js';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class LocationsController {
  constructor(
    private readonly locations: LocationsService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('hubs') async hubs(@CurrentUser() user: AuthUser) {
    return {
      data: await this.locations.listHubs(this.clients.requireClientId(user)),
    };
  }
  @Post('hubs') async createHub(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHubDto,
  ) {
    return {
      data: await this.locations.createHub(
        this.clients.requireClientId(user),
        dto,
      ),
    };
  }
}
