import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
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
  DisputeReturnPenaltyDto,
  ListRideReturnsDto,
  OverrideReturnPenaltyDto,
  ReceiveRideReturnDto,
  ReplaceReturnPenaltiesDto,
  ReturnPenaltyPriceDto,
  UpdateReturnPenaltyPriceDto,
  VerifyReturnPenaltyOtpDto,
} from './dto/ride-return.dto.js';
import { RideReturnsService } from './ride-returns.service.js';

const clientRoles = [UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.FLEET_MANAGER];

@Controller('client/ride-returns')
@ApiTags('Client Operations · Ride Returns')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(...clientRoles)
export class RideReturnsController {
  constructor(private readonly context: ClientContextService, private readonly returns: RideReturnsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for the return request.' })
  async create(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string, @Body() dto: CreateRideReturnDto) {
    return { data: await this.returns.request(this.context.requireClientId(user), user, dto, key, 'STAFF') };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRideReturnsDto) {
    return { data: await this.returns.list(this.context.requireClientId(user), user, query) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.get(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/receive')
  async receive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReceiveRideReturnDto) {
    return { data: await this.returns.receive(this.context.requireClientId(user), user, id, dto) };
  }

  @Put(':id/penalties')
  async replacePenalties(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplaceReturnPenaltiesDto) {
    return { data: await this.returns.replacePenalties(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/penalties/submit')
  async submitPenalties(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.submitPenalties(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/penalties/override-rider-approval')
  @Roles(UserRole.CLIENT_ADMIN)
  async overridePenalties(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OverrideReturnPenaltyDto) {
    return { data: await this.returns.overridePenalties(this.context.requireClientId(user), user, id, dto) };
  }

  @Post(':id/penalties/approve')
  async approvePenalties(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.approvePenalties(this.context.requireClientId(user), user, id) };
  }
}

@Controller('client/return-penalty-prices')
@ApiTags('Client Operations · Ride Returns')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(...clientRoles)
export class ReturnPenaltyPriceController {
  constructor(private readonly context: ClientContextService, private readonly returns: RideReturnsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.returns.prices(this.context.requireClientId(user)) };
  }

  @Post()
  @Roles(UserRole.CLIENT_ADMIN)
  async create(@CurrentUser() user: AuthUser, @Body() dto: ReturnPenaltyPriceDto) {
    return { data: await this.returns.createPrice(this.context.requireClientId(user), user.id, dto) };
  }

  @Patch(':id')
  @Roles(UserRole.CLIENT_ADMIN)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateReturnPenaltyPriceDto) {
    return { data: await this.returns.updatePrice(this.context.requireClientId(user), user.id, id, dto) };
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

  @Post(':id/penalties/otp/request')
  async requestOtp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.returns.riderPenaltyOtpRequest(this.context.requireClientId(user), user, id) };
  }

  @Post(':id/penalties/otp/verify')
  async verifyOtp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VerifyReturnPenaltyOtpDto) {
    return { data: await this.returns.verifyRiderPenaltyOtp(this.context.requireClientId(user), user, id, dto.otpRequestId, dto.code) };
  }

  @Post(':id/penalties/dispute')
  async dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DisputeReturnPenaltyDto) {
    return { data: await this.returns.disputePenalties(this.context.requireClientId(user), user, id, dto) };
  }
}
