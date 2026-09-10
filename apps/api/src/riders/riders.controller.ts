import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CreateRiderDto } from './dto/create-rider.dto.js';
import { ListRidersDto } from './dto/list-riders.dto.js';
import { UpdateRiderDto } from './dto/update-rider.dto.js';
import { RidersService } from './riders.service.js';

@Controller('riders')
@UseGuards(AccessTokenGuard, RolesGuard)
export class RidersController {
  constructor(
    private readonly ridersService: RidersService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER, UserRole.KYC_OPERATOR)
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRidersDto) {
    return { data: await this.ridersService.list(this.tenantContext.requireTenantId(user), query) };
  }

  @Post()
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateRiderDto) {
    return { data: await this.ridersService.create(this.tenantContext.requireTenantId(user), dto) };
  }

  @Get(':id')
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER, UserRole.KYC_OPERATOR)
  async getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.ridersService.getById(this.tenantContext.requireTenantId(user), id) };
  }

  @Patch(':id')
  @Roles(UserRole.TENANT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.KYC_OPERATOR)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRiderDto) {
    return { data: await this.ridersService.update(this.tenantContext.requireTenantId(user), id, dto) };
  }
}
