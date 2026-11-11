import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ImportEntityType, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ClientUsersService } from './client-users.service.js';
import {
  BulkFleetManagerDto,
  BulkTeamLeaderDto,
  CreateTeamLeaderDto,
  AssignTeamLeaderRidersDto,
  CreateFleetManagerDto,
  ReassignTeamLeaderDto,
} from './dto/create-client-user.dto.js';
import { importFailuresToCsv } from '../imports/import-failure.js';

@Controller('client/users')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ClientUsersController {
  constructor(
    private readonly users: ClientUsersService,
    private readonly clients: ClientContextService,
  ) {}
  @Get('import-history') importHistory(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType: ImportEntityType,
  ) {
    if (!Object.values(ImportEntityType).includes(entityType))
      throw new BadRequestException('Valid entityType is required.');
    return this.users
      .listImportHistory(this.clients.requireClientId(user), entityType)
      .then((data) => ({ data }));
  }
  @Post('fleet-managers') create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFleetManagerDto,
  ) {
    return this.users
      .createFleetManager(this.clients.requireClientId(user), dto)
      .then((data) => ({ data }));
  }
  @Get('fleet-managers') listFleetManagers(@CurrentUser() user: AuthUser) {
    return this.users
      .listFleetManagers(this.clients.requireClientId(user))
      .then((data) => ({ data }));
  }
  @Patch('fleet-managers/:id') updateFleetManager(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateFleetManagerDto,
  ) {
    return this.users
      .updateFleetManager(this.clients.requireClientId(user), id, dto)
      .then((data) => ({ data }));
  }
  @Delete('fleet-managers/:id') deleteFleetManager(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.users.deleteFleetManager(this.clients.requireClientId(user), id).then((data) => ({ data }));
  }
  @Post('fleet-managers/bulk') bulk(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkFleetManagerDto,
  ) {
    return this.users
      .bulkCreateFleetManagers(
        this.clients.requireClientId(user),
        user.id,
        dto.filename,
        dto.rows,
      )
      .then((data) => ({ data }));
  }
  @Get('fleet-managers/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedFleetManagerRecords(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const rows = await this.users.failedRows(
      this.clients.requireClientId(user),
      id,
      ImportEntityType.FLEET_MANAGER,
    );
    return this.toCsv(rows);
  }
  @Roles(UserRole.CLIENT_ADMIN)
  @Post('fleet-managers/imports/:id/retry') retryFleetManagerImport(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { rows: CreateFleetManagerDto[] }) {
    return this.users.retryFleetManagerImport(this.clients.requireClientId(user), user.id, id, dto.rows, user.roles[0] as UserRole).then((data) => ({ data }));
  }
  @Post('team-leaders') teamLeader(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTeamLeaderDto,
  ) {
    return this.users
      .createTeamLeader(this.clients.requireClientId(user), dto)
      .then((data) => ({ data }));
  }
  @Get('team-leaders') listTeamLeaders(@CurrentUser() user: AuthUser) {
    return this.users
      .listTeamLeaders(this.clients.requireClientId(user))
      .then((data) => ({ data }));
  }
  @Patch('team-leaders/:id') updateTeamLeader(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTeamLeaderDto,
  ) {
    return this.users
      .updateTeamLeader(this.clients.requireClientId(user), id, dto)
      .then((data) => ({ data }));
  }
  @Post('team-leaders/:id/reassign') reassignTeamLeader(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReassignTeamLeaderDto,
  ) {
    return this.users.reassignTeamLeader(this.clients.requireClientId(user), id, dto.targetTeamLeaderId).then((data) => ({ data }));
  }
  @Post('team-leaders/bulk') bulkTeamLeaders(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkTeamLeaderDto,
  ) {
    return this.users
      .bulkCreateTeamLeaders(
        this.clients.requireClientId(user),
        user.id,
        dto.filename,
        dto.rows,
      )
      .then((data) => ({ data }));
  }
  @Get('team-leaders/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedTeamLeaderRecords(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const rows = await this.users.failedRows(
      this.clients.requireClientId(user),
      id,
      ImportEntityType.TEAM_LEADER,
    );
    return this.toCsv(rows);
  }
  @Roles(UserRole.CLIENT_ADMIN)
  @Post('team-leaders/imports/:id/retry') retryTeamLeaderImport(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { rows: CreateTeamLeaderDto[] }) {
    return this.users.retryTeamLeaderImport(this.clients.requireClientId(user), user.id, id, dto.rows, user.roles[0] as UserRole).then((data) => ({ data }));
  }
  @Post('team-leaders/:id/riders') assignRiders(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignTeamLeaderRidersDto,
  ) {
    return this.users
      .assignRiders(this.clients.requireClientId(user), id, dto)
      .then((data) => ({ data }));
  }
  private toCsv(rows: Parameters<typeof importFailuresToCsv>[0]) {
    return importFailuresToCsv(rows);
  }
}
