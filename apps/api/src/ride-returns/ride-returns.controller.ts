import { SparesService } from '../spares/spares.service.js';
import { FleetManagerActionGuard, FleetActionResource } from '../auth/guards/fleet-manager-action.guard.js';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  CreateRideReturnDto,
  ListRideReturnsDto,
} from './dto/ride-return.dto.js';
import { RideReturnsService } from './ride-returns.service.js';

const clientRoles = [UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER];

@Controller('client/ride-returns')
@ApiTags('Client Operations · Ride Returns')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard, FleetManagerActionGuard)
@FleetActionResource('return')
@Roles(...clientRoles)
export class RideReturnsController {
  constructor(private readonly context: ClientContextService, private readonly returns: RideReturnsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for the return request.' })
  async create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() dto: CreateRideReturnDto) {
    return { data: await this.returns.request(this.context.requireClientId(user), user, dto, key, 'STAFF') };
  }

}

@Controller('client/return-penalty-prices')
@ApiTags('Client Operations · Ride Returns')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(...clientRoles)
export class ReturnPenaltyPriceController {
  constructor(private readonly context: ClientContextService, private readonly spares: SparesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string,string>) {
    return this.spares.catalogue(this.context.requireClientId(user),user,query);
  }

}

@Controller('rider-app/ride-returns')
@ApiTags('Rider App')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderRideReturnsController {
  constructor(private readonly context: ClientContextService, private readonly returns: RideReturnsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for the return request.' })
  async create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() dto: CreateRideReturnDto) {
    return { data: await this.returns.request(this.context.requireClientId(user), user, dto, key, 'RIDER') };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRideReturnsDto) {
    return { data: await this.returns.riderList(this.context.requireClientId(user), user, query) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.riderGet(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.cancel(this.context.requireClientId(user), user, id) };
  }
}
