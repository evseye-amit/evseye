import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateHubDto } from './dto/create-hub.dto.js';
import { CreateZoneDto } from './dto/create-zone.dto.js';
import { LocationsService } from './locations.service.js';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER)
export class LocationsController {
  constructor(private readonly locations: LocationsService, private readonly tenants: TenantContextService) {}
  @Get('zones') zones(@CurrentUser() user: AuthUser) { return { data: this.locations.listZones(this.tenants.requireTenantId(user)) }; }
  @Post('zones') createZone(@CurrentUser() user: AuthUser, @Body() dto: CreateZoneDto) { return { data: this.locations.createZone(this.tenants.requireTenantId(user), dto) }; }
  @Get('hubs') hubs(@CurrentUser() user: AuthUser) { return { data: this.locations.listHubs(this.tenants.requireTenantId(user)) }; }
  @Post('hubs') createHub(@CurrentUser() user: AuthUser, @Body() dto: CreateHubDto) { return { data: this.locations.createHub(this.tenants.requireTenantId(user), dto) }; }
}
