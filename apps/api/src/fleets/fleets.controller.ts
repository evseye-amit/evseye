import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FleetStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateFleetDto } from './dto/create-fleet.dto.js';
import { ListFleetsDto } from './dto/list-fleets.dto.js';
import {
  CreateBatteryDto,
  CreateControllerDto,
} from './dto/create-component.dto.js';
import { FleetsService } from './fleets.service.js';
import { ComponentsService } from './components.service.js';
@Controller('fleets')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.TENANT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class FleetsController {
  constructor(
    private readonly fleets: FleetsService,
    private readonly components: ComponentsService,
    private readonly tenants: TenantContextService,
  ) {}
  @Get() async list(@CurrentUser() u: AuthUser, @Query() q: ListFleetsDto) {
    return { data: await this.fleets.list(this.tenants.requireTenantId(u), q) };
  }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() d: CreateFleetDto) {
    return {
      data: await this.fleets.create(this.tenants.requireTenantId(u), d),
    };
  }
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.fleets.get(this.tenants.requireTenantId(u), id) };
  }
  @Get(':id/current-state') async currentState(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.fleets.currentState(this.tenants.requireTenantId(u), id),
    };
  }
  @Patch(':id/status') async status(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body('status') s: FleetStatus,
  ) {
    return {
      data: await this.fleets.changeStatus(
        this.tenants.requireTenantId(u),
        id,
        s,
      ),
    };
  }
  @Post(':id/batteries') async battery(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: CreateBatteryDto,
  ) {
    return {
      data: await this.components.addBattery(
        this.tenants.requireTenantId(u),
        id,
        d,
      ),
    };
  }
  @Post(':id/controllers') async controller(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: CreateControllerDto,
  ) {
    return {
      data: await this.components.addController(
        this.tenants.requireTenantId(u),
        id,
        d,
      ),
    };
  }
}
