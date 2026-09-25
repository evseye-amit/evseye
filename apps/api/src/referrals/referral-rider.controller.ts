import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { AttributionDto, ListReferralNotificationsDto, ListReferralsDto, PublicReferralQueryDto } from './dto/referral.dto.js';
import { ReferralService } from './referral.service.js';

@Controller('rider-app/referrals')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class ReferralRiderController {
  constructor(private readonly referrals: ReferralService, private readonly clients: ClientContextService) {}
  @Get('home') async home(@CurrentUser() user: AuthUser) { return { data: await this.referrals.home(this.clients.requireClientId(user), user.id) }; }
  @Post('invites') @Throttle({ default: { limit: 10, ttl: 60000 } })
  async invite(@CurrentUser() user: AuthUser) { return { data: await this.referrals.invite(this.clients.requireClientId(user), user.id) }; }
  @Post('attribute') @Throttle({ default: { limit: 10, ttl: 60000 } })
  async attribute(@CurrentUser() user: AuthUser, @Body() dto: AttributionDto) { return { data: await this.referrals.attribute(this.clients.requireClientId(user), user.id, dto) }; }
  @Get('notifications') async notifications(@CurrentUser() user: AuthUser, @Query() query: ListReferralNotificationsDto) { return { data: await this.referrals.notifications(this.clients.requireClientId(user), user.id, query) }; }
  @Get() async list(@CurrentUser() user: AuthUser, @Query() query: ListReferralsDto) { return { data: await this.referrals.mine(this.clients.requireClientId(user), user.id, query) }; }
  @Get(':id') async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.referrals.detail(this.clients.requireClientId(user), id, user.id) }; }
}

@Controller('public/referrals')
export class PublicReferralController {
  constructor(private readonly referrals: ReferralService) {}
  @Get('resolve') @Throttle({ default: { limit: 20, ttl: 60000 } })
  async resolve(@Query() query: PublicReferralQueryDto) { return { data: await this.referrals.resolvePublic(query.code) }; }
}
