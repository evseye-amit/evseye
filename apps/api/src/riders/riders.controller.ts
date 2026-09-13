import {
  Body,
  Controller,
  Get,
  Header,
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
import { ClientContextService } from '../auth/client-context.service.js';
import { BulkRiderDto, CreateRiderDto } from './dto/create-rider.dto.js';
import { ListRidersDto } from './dto/list-riders.dto.js';
import { UpdateRiderDto } from './dto/update-rider.dto.js';
import { RidersService } from './riders.service.js';

@Controller('riders')
@UseGuards(AccessTokenGuard, RolesGuard)
export class RidersController {
  constructor(
    private readonly ridersService: RidersService,
    private readonly audit: AuditService,
    private readonly clientContext: ClientContextService,
  ) {}

  @Get()
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRidersDto) {
    return {
      data: await this.ridersService.list(
        this.clientContext.requireClientId(user),
        query,
      ),
    };
  }

  @Post()
  @Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRiderDto) {
    const clientId = this.clientContext.requireClientId(user);
    const rider = await this.ridersService.create(clientId, dto);
    await this.audit.record({
      clientId,
      actorId: user.id,
      action: 'RIDER_CREATED',
      entityType: 'RIDER',
      entityId: rider.id,
      newData: { status: rider.status },
    });
    return { data: rider };
  }
  @Post('bulk')
  @Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
  async bulkCreate(@CurrentUser() user: AuthUser, @Body() dto: BulkRiderDto) {
    return {
      data: await this.ridersService.bulkCreate(
        this.clientContext.requireClientId(user),
        user.id,
        dto.filename,
        dto.rows,
      ),
    };
  }
  @Get('imports/:id/failed-records')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async failedRecords(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const rows = await this.ridersService.failedRows(
      this.clientContext.requireClientId(user),
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

  @Get(':id')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.FLEET_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return {
      data: await this.ridersService.getById(
        this.clientContext.requireClientId(user),
        id,
      ),
    };
  }

  @Patch(':id')
  @Roles(
    UserRole.CLIENT_ADMIN,
    UserRole.OPERATIONS_MANAGER,
    UserRole.KYC_OPERATOR,
  )
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRiderDto,
  ) {
    const clientId = this.clientContext.requireClientId(user);
    const rider = await this.ridersService.update(clientId, id, dto);
    await this.audit.record({
      clientId,
      actorId: user.id,
      action: 'RIDER_UPDATED',
      entityType: 'RIDER',
      entityId: rider.id,
      newData: {
        changedFields: Object.keys(dto),
        status: rider.status,
      },
    });
    return { data: rider };
  }
}
