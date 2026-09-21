import {
  Body,
  Controller,
  Get,
  Header,
  Delete,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ImportEntityType, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CreateFleetDto } from './dto/create-fleet.dto.js';
import { BulkFleetDto } from './dto/bulk-fleet.dto.js';
import { ListFleetsDto } from './dto/list-fleets.dto.js';
import {
  CreateBatteryDto,
  CreateControllerDto,
} from './dto/create-component.dto.js';
import { ChangeFleetStatusDto } from './dto/change-fleet-status.dto.js';
import { UpdateFleetDto } from './dto/update-fleet.dto.js';
import { FleetsService } from './fleets.service.js';
import { ComponentsService } from './components.service.js';
@Controller('fleets')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class FleetsController {
  constructor(
    private readonly fleets: FleetsService,
    private readonly components: ComponentsService,
    private readonly audit: AuditService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async list(@CurrentUser() u: AuthUser, @Query() q: ListFleetsDto) {
    return { data: await this.fleets.list(this.clients.requireClientId(u), q) };
  }
  @Get('onboarding-options') onboardingOptions() {
    return this.fleets.onboardingOptions().then((data) => ({ data }));
  }
  @Get('batteries') async listBatteries(@CurrentUser() u: AuthUser) {
    return {
      data: await this.components.listBatteries(
        this.clients.requireClientId(u),
      ),
    };
  }
  @Get('controllers') async listControllers(@CurrentUser() u: AuthUser) {
    return {
      data: await this.components.listControllers(
        this.clients.requireClientId(u),
      ),
    };
  }
  @Get('component-mappings') async componentMappings(@CurrentUser() u: AuthUser) {
    return { data: await this.components.listMappings(this.clients.requireClientId(u)) };
  }
  @Post('component-mappings') async saveComponentMapping(@CurrentUser() u: AuthUser, @Body() data: { fleetId: string; iotDeviceId?: string | null; batteryIds?: string[]; controllerId?: string | null }) {
    return { data: await this.components.saveMapping(this.clients.requireClientId(u), data) };
  }
  @Patch('component-mappings/:fleetId') async updateComponentMapping(@CurrentUser() u: AuthUser, @Param('fleetId') fleetId: string, @Body() data: { iotDeviceId?: string | null; batteryIds?: string[]; controllerId?: string | null }) {
    return { data: await this.components.saveMapping(this.clients.requireClientId(u), { ...data, fleetId }) };
  }
  @Post('component-mappings/bulk') async bulkComponentMappings(@CurrentUser() u: AuthUser, @Body() d: BulkFleetDto) {
    const clientId = this.clients.requireClientId(u);
    return { data: await this.components.bulkSaveMappings(clientId, u.id, d.filename, d.rows) };
  }
  @Get('component-mappings/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedComponentMappingRecords(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const rows = await this.components.failedRows(this.clients.requireClientId(u), id, ImportEntityType.FLEET_COMPONENT_MAPPING);
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]); const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [headers.join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\n');
  }
  @Post('batteries') async createBattery(@CurrentUser() u: AuthUser, @Body() d: CreateBatteryDto) {
    const clientId = this.clients.requireClientId(u);
    return { data: await this.components.addBattery(clientId, d.fleetId, d) };
  }
  @Post('controllers') async createController(@CurrentUser() u: AuthUser, @Body() d: CreateControllerDto) {
    const clientId = this.clients.requireClientId(u);
    return { data: await this.components.addController(clientId, d.fleetId, d) };
  }
  @Patch('batteries/:batteryId') async updateStandaloneBattery(@CurrentUser() u: AuthUser, @Param('batteryId') batteryId: string, @Body() d: CreateBatteryDto) {
    return { data: await this.components.updateStandaloneBattery(this.clients.requireClientId(u), batteryId, d) };
  }
  @Patch('controllers/:controllerId') async updateStandaloneController(@CurrentUser() u: AuthUser, @Param('controllerId') controllerId: string, @Body() d: CreateControllerDto) {
    return { data: await this.components.updateStandaloneController(this.clients.requireClientId(u), controllerId, d) };
  }
  @Post('batteries/bulk') async bulkBatteries(
    @CurrentUser() u: AuthUser,
    @Body() d: BulkFleetDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    return { data: await this.components.bulkCreate(clientId, u.id, d.filename, 'BATTERY', d.rows) };
  }
  @Post('controllers/bulk') async bulkControllers(
    @CurrentUser() u: AuthUser,
    @Body() d: BulkFleetDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    return { data: await this.components.bulkCreate(clientId, u.id, d.filename, 'CONTROLLER', d.rows) };
  }
  @Get(':kind/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedComponentRecords(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Param('id') id: string) {
    const entityType = kind === 'batteries' ? ImportEntityType.BATTERY : kind === 'controllers' ? ImportEntityType.CONTROLLER : null;
    if (!entityType) return '';
    const rows = await this.components.failedRows(this.clients.requireClientId(u), id, entityType);
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [headers.join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\n');
  }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() d: CreateFleetDto) {
    const clientId = this.clients.requireClientId(u);
    const fleet = await this.fleets.create(clientId, d);
    await this.audit.record({
      clientId,
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
  @Post('bulk') async bulkCreate(
    @CurrentUser() u: AuthUser,
    @Body() d: BulkFleetDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    return {
      data: await this.fleets.bulkCreate(clientId, u.id, d.filename, d.rows),
    };
  }
  @Get('imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedRecords(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const rows = await this.fleets.failedRows(
      this.clients.requireClientId(u),
      id,
    );
    if (!rows.length) return '';
    const headers = Object.keys(rows[0] as Record<string, unknown>);
    const cell = (value: unknown) =>
      `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => cell((row as Record<string, unknown>)[header]))
          .join(','),
      ),
    ].join('\n');
  }
  @Get(':id/onboarding-status')
  async onboardingStatus(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return {
      data: await this.fleets.onboardingStatus(
        this.clients.requireClientId(u),
        id,
      ),
    };
  }
  @Get(':id') async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return { data: await this.fleets.get(this.clients.requireClientId(u), id) };
  }
  @Patch(':id') async update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFleetDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    const fleet = await this.fleets.update(clientId, id, dto);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'FLEET_UPDATED',
      entityType: 'FLEET',
      entityId: id,
      newData: dto,
    });
    return { data: fleet };
  }
  @Post(':id/activate') async activate(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    const fleet = await this.fleets.activate(clientId, id, u.id);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'FLEET_ACTIVATED',
      entityType: 'FLEET',
      entityId: id,
      newData: {
        status: fleet.status,
        onboardingStatus: fleet.onboardingStatus,
      },
    });
    return { data: fleet };
  }
  @Delete(':id') async remove(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const clientId = this.clients.requireClientId(u);
    await this.fleets.remove(clientId, id);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'FLEET_DELETED',
      entityType: 'FLEET',
      entityId: id,
    });
    return { data: { deleted: true } };
  }
  @Get(':id/current-state') async currentState(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.fleets.currentState(this.clients.requireClientId(u), id),
    };
  }
  @Patch(':id/status') async status(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeFleetStatusDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    const fleet = await this.fleets.changeStatus(
      clientId,
      id,
      dto.status,
      u.id,
      dto.reason,
    );
    await this.audit.record({
      clientId,
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
    const clientId = this.clients.requireClientId(u);
    const battery = await this.components.addBattery(clientId, id, d);
    await this.audit.record({
      clientId,
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
    const clientId = this.clients.requireClientId(u);
    const controller = await this.components.addController(clientId, id, d);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'CONTROLLER_ADDED',
      entityType: 'CONTROLLER',
      entityId: controller.id,
      newData: { fleetId: id, controllerNumber: controller.controllerNumber },
    });
    return {
      data: controller,
    };
  }

  @Patch(':id/batteries/:batteryId')
  async updateBattery(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('batteryId') batteryId: string,
    @Body() d: CreateBatteryDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    const battery = await this.components.updateBattery(clientId, id, batteryId, d);
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'BATTERY_UPDATED',
      entityType: 'BATTERY',
      entityId: battery.id,
      newData: { fleetId: id, serialNumber: battery.serialNumber },
    });
    return { data: battery };
  }

  @Patch(':id/controllers/:controllerId')
  async updateController(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('controllerId') controllerId: string,
    @Body() d: CreateControllerDto,
  ) {
    const clientId = this.clients.requireClientId(u);
    const controller = await this.components.updateController(
      clientId,
      id,
      controllerId,
      d,
    );
    await this.audit.record({
      clientId,
      actorId: u.id,
      action: 'CONTROLLER_UPDATED',
      entityType: 'CONTROLLER',
      entityId: controller.id,
      newData: { fleetId: id, controllerNumber: controller.controllerNumber },
    });
    return { data: controller };
  }
}
