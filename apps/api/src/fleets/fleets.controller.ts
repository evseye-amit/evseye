import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FleetStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'; import { Roles } from '../auth/decorators/roles.decorator.js'; import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'; import { RolesGuard } from '../auth/guards/roles.guard.js'; import type { AuthUser } from '../auth/interfaces/auth-user.interface.js'; import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateFleetDto } from './dto/create-fleet.dto.js'; import { ListFleetsDto } from './dto/list-fleets.dto.js'; import { CreateBatteryDto, CreateControllerDto } from './dto/create-component.dto.js'; import { FleetsService } from './fleets.service.js'; import { ComponentsService } from './components.service.js';
@Controller('fleets') @UseGuards(AccessTokenGuard, RolesGuard) @Roles(UserRole.TENANT_ADMIN,UserRole.OPERATIONS_MANAGER,UserRole.FLEET_MANAGER)
export class FleetsController { constructor(private readonly fleets: FleetsService, private readonly components: ComponentsService, private readonly tenants: TenantContextService) {}
  @Get() list(@CurrentUser() u: AuthUser,@Query() q: ListFleetsDto){ return {data:this.fleets.list(this.tenants.requireTenantId(u),q)}; }
  @Post() create(@CurrentUser() u: AuthUser,@Body() d: CreateFleetDto){ return {data:this.fleets.create(this.tenants.requireTenantId(u),d)}; }
  @Get(':id') get(@CurrentUser() u: AuthUser,@Param('id') id:string){ return {data:this.fleets.get(this.tenants.requireTenantId(u),id)}; }
  @Get(':id/current-state') currentState(@CurrentUser()u:AuthUser,@Param('id')id:string){return {data:this.fleets.currentState(this.tenants.requireTenantId(u),id)};}
  @Patch(':id/status') status(@CurrentUser() u: AuthUser,@Param('id') id:string,@Body('status') s:FleetStatus){ return {data:this.fleets.changeStatus(this.tenants.requireTenantId(u),id,s)}; }
  @Post(':id/batteries') battery(@CurrentUser() u: AuthUser,@Param('id') id:string,@Body() d:CreateBatteryDto){return {data:this.components.addBattery(this.tenants.requireTenantId(u),id,d)};}
  @Post(':id/controllers') controller(@CurrentUser() u: AuthUser,@Param('id') id:string,@Body() d:CreateControllerDto){return {data:this.components.addController(this.tenants.requireTenantId(u),id,d)};}
}
