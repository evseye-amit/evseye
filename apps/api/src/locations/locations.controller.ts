import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CreateHubDto } from './dto/create-hub.dto.js';
import { BulkHubDto } from './dto/bulk-hub.dto.js';
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
  @Patch('hubs/:id') async updateHub(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateHubDto,
  ) {
    return {
      data: await this.locations.updateHub(
        this.clients.requireClientId(user),
        id,
        dto,
      ),
    };
  }
  @Delete('hubs/:id') async deleteHub(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return { data: await this.locations.deleteHub(this.clients.requireClientId(user), id) };
  }
  @Post('hubs/bulk') async bulkHubs(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkHubDto,
  ) {
    return {
      data: await this.locations.bulkCreateHubs(
        this.clients.requireClientId(user),
        user.id,
        dto.filename,
        dto.rows,
      ),
    };
  }
  @Get('hubs/imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedHubRecords(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const rows = await this.locations.failedRows(
      this.clients.requireClientId(user),
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
}
