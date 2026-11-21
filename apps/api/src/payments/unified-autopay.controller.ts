import { ConfigService } from '@nestjs/config';
import { WalletAutoRechargeService } from './wallet-auto-recharge.service.js';
import { unifiedAutoPayEnabled } from './unified-autopay-rollout.js';
import { BadRequestException, Body, Controller, DefaultValuePipe, Get, Headers, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { UnifiedAutoPayService } from './unified-autopay.service.js';
import { MandateService } from './mandate.service.js';
class PreferenceDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(0) expectedRevision!: number;
}
class SetupDto { @IsEmail() @MaxLength(254) email!: string; }
@Controller('rider-app/autopay')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class UnifiedAutoPayController {
  constructor(private readonly service: UnifiedAutoPayService, private readonly mandates: MandateService, private readonly clients: ClientContextService) {}
  @Get() async current(@CurrentUser() user: AuthUser) { return { data: await this.service.current(this.clients.requireClientId(user), user.id) }; }
  @Put() async set(@CurrentUser() user: AuthUser, @Body() body: PreferenceDto) { return { data: await this.service.set(this.clients.requireClientId(user), user.id, body) }; }
  @Get('recharges') async history(@CurrentUser() user: AuthUser, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    if (page < 1 || page > 100000) throw new BadRequestException('INVALID_PAGE');
    return { data: await this.service.recharges(this.clients.requireClientId(user), user.id, page) };
  }
  @Post('mandates') async setup(@CurrentUser() user: AuthUser, @Body() body: SetupDto, @Headers('Idempotency-Key') key?: string) {
    const clientId = this.clients.requireClientId(user);
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(key ?? '')) throw new BadRequestException('INVALID_IDEMPOTENCY_KEY');
    await this.service.prepareSetup(clientId, user.id);
    return { data: await this.mandates.create(clientId, user.id, key ?? '', 'UPI_AUTOPAY', body.email, true) };
  }
  @Post('mandates/:mandateId/verify') async verify(@CurrentUser() user: AuthUser, @Param('mandateId') id: string) { return { data: await this.mandates.verify(this.clients.requireClientId(user), user.id, id) }; }
  @Post('mandates/:mandateId/cancel') async cancel(@CurrentUser() user: AuthUser, @Param('mandateId') id: string, @Headers('Idempotency-Key') key?: string) { return { data: await this.mandates.cancel(this.clients.requireClientId(user), user.id, id, key ?? '') }; }
}

class PolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,4})\.\d{2}$/) threshold!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,4})\.\d{2}$/) rechargeAmount!: string;
  @IsInt() @Min(0) revision!: number;
}
@Controller('client/autopay/policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class UnifiedAutoPayPolicyController {
  constructor(private readonly funding: WalletAutoRechargeService, private readonly clients: ClientContextService, private readonly config: ConfigService) {}
  @Get() async current(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return { data: { ...await this.funding.policy(clientId), unifiedRollout: unifiedAutoPayEnabled(this.config, clientId) } };
  }
  @Put() async set(@CurrentUser() user: AuthUser, @Body() body: PolicyDto) {
    const clientId = this.clients.requireClientId(user);
    return { data: { ...await this.funding.setPolicy(clientId, user.id, body), unifiedRollout: unifiedAutoPayEnabled(this.config, clientId) } };
  }
  @Get('history') async history(@CurrentUser() user: AuthUser, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    if (page < 1 || page > 100000) throw new BadRequestException('INVALID_PAGE');
    return { data: await this.funding.policyHistory(this.clients.requireClientId(user), page) };
  }
}

@Controller('client/autopay/recharges')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class UnifiedAutoPayOperationsController {
  constructor(private readonly funding: WalletAutoRechargeService, private readonly clients: ClientContextService) {}
  @Get() async list(@CurrentUser() user: AuthUser, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    if (page < 1 || page > 100000) throw new BadRequestException('INVALID_PAGE');
    return { data: await this.funding.list(this.clients.requireClientId(user), page) };
  }
  @Post(':id/verify') async verify(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.funding.verifyForClient(this.clients.requireClientId(user), id) };
  }
}
