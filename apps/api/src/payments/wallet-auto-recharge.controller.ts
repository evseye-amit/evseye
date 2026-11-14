import {
  Body,
  Controller,
  Get,
  Put,
  Post,
  Param,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Matches,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { WalletAutoRechargeService } from './wallet-auto-recharge.service.js';
class RechargePolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,4})\.\d{2}$/) threshold!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,4})\.\d{2}$/) rechargeAmount!: string;
  @IsInt() @Min(0) revision!: number;
}
class RechargeConsentDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() mandateId?: string;
  @IsOptional() @IsInt() @Min(1) consentRevision?: number;
}
@Controller('client/wallet-autopay-policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class WalletAutoRechargePolicyController {
  constructor(
    private readonly service: WalletAutoRechargeService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async get(@CurrentUser() user: AuthUser) {
    return {
      data: await this.service.policy(this.clients.requireClientId(user)),
    };
  }
  @Get('requests') async list(
    @CurrentUser() user: AuthUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > 100000)
      throw new BadRequestException('Invalid page.');
    return {
      data: await this.service.list(this.clients.requireClientId(user), page),
    };
  }
  @Post('requests/:id/verify') async verify(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return {
      data: await this.service.verifyForClient(
        this.clients.requireClientId(user),
        id,
      ),
    };
  }
  @Put() async put(
    @CurrentUser() user: AuthUser,
    @Body() dto: RechargePolicyDto,
  ) {
    return {
      data: await this.service.setPolicy(
        this.clients.requireClientId(user),
        user.id,
        dto,
      ),
    };
  }
}
@Controller('rider-app/wallet/autopay')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderWalletAutoRechargeController {
  constructor(
    private readonly service: WalletAutoRechargeService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async get(@CurrentUser() user: AuthUser) {
    return {
      data: await this.service.current(
        this.clients.requireClientId(user),
        user.id,
      ),
    };
  }
  @Put() async put(
    @CurrentUser() user: AuthUser,
    @Body() dto: RechargeConsentDto,
  ) {
    return {
      data: await this.service.setEnabled(
        this.clients.requireClientId(user),
        user.id,
        dto,
      ),
    };
  }
}
