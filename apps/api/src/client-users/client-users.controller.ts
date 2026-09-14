import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
} from './dto/create-client-user.dto.js';

@Controller('client/users')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ClientUsersController {
  constructor(
    private readonly users: ClientUsersService,
    private readonly clients: ClientContextService,
  ) {}
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
  @Post('team-leaders/:id/riders') assignRiders(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignTeamLeaderRidersDto,
  ) {
    return this.users
      .assignRiders(this.clients.requireClientId(user), id, dto)
      .then((data) => ({ data }));
  }
  private toCsv(rows: unknown[]) {
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
}
