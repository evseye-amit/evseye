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
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
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
import { ChangeFleetStatusDto } from './dto/change-fleet-status.dto.js';
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
    private readonly audit: AuditService,
    private readonly tenants: TenantContextService,
  ) {}
  @Get() async list(@CurrentUser() u: AuthUser, @Query() q: ListFleetsDto) {
    return { data: await this.fleets.list(this.tenants.requireTenantId(u), q) };
  }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() d: CreateFleetDto) {
    const tenantId = this.tenants.requireTenantId(u);
    const fleet = await this.fleets.create(tenantId, d);
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'FLEET_CREATED',
      entityType: 'FLEET',
      entityId: fleet.id,
      newData: { vehicleNumber: fleet.vehicleNumber, status: fleet.status },
    });
    return {
      data: fleet,
    };
  }
  @Get(':id/onboarding-status')
  async onboardingStatus(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return {
      data: await this.fleets.onboardingStatus(
        this.tenants.requireTenantId(u),
        id,
      ),
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
    @Body() dto: ChangeFleetStatusDto,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const fleet = await this.fleets.changeStatus(tenantId, id, dto.status);
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'FLEET_STATUS_CHANGED',
      entityType: 'FLEET',
      entityId: id,
      newData: { status: fleet.status },
    });
    return {
      data: fleet,
    };
  }
  @Post(':id/batteries') async battery(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: CreateBatteryDto,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const battery = await this.components.addBattery(tenantId, id, d);
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'BATTERY_ADDED',
      entityType: 'BATTERY',
      entityId: battery.id,
      newData: { fleetId: id, serialNumber: battery.serialNumber },
    });
    return {
      data: battery,
    };
  }
  @Post(':id/controllers') async controller(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: CreateControllerDto,
  ) {
    const tenantId = this.tenants.requireTenantId(u);
    const controller = await this.components.addController(tenantId, id, d);
    await this.audit.record({
      tenantId,
      actorId: u.id,
      action: 'CONTROLLER_ADDED',
      entityType: 'CONTROLLER',
      entityId: controller.id,
      newData: { fleetId: id, serialNumber: controller.serialNumber },
    });
    return {
      data: controller,
    };
  }
}
