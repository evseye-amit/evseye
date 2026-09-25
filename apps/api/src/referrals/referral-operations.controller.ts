import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ActivityEventDto, CampaignDto, DuplicateCampaignDto, FraudReviewDto, ListCampaignsDto, ListReferralsDto, ListRewardsDto, PayoutDto, ReasonDto } from './dto/referral.dto.js';
import { ReferralCampaignService } from './referral-campaign.service.js';
import { ReferralService } from './referral.service.js';
import { ReferralQualificationService } from './referral-qualification.service.js';
import { ReferralRewardService } from './referral-reward.service.js';
import { ReferralAnalyticsService } from './referral-analytics.service.js';
import { ReferralFraudService } from './referral-fraud.service.js';

@Controller('client/referrals')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class ReferralOperationsController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly campaigns: ReferralCampaignService,
    private readonly referrals: ReferralService,
    private readonly qualification: ReferralQualificationService,
    private readonly rewards: ReferralRewardService,
    private readonly analytics: ReferralAnalyticsService,
    private readonly fraud: ReferralFraudService,
  ) {}

  @Get('campaigns') async campaignsList(@CurrentUser() user: AuthUser, @Query() query: ListCampaignsDto) { return { data: await this.campaigns.list(this.clients.requireClientId(user), query) }; }
  @Post('campaigns') @Roles(UserRole.CLIENT_ADMIN) async campaignCreate(@CurrentUser() user: AuthUser, @Body() dto: CampaignDto) { return { data: await this.campaigns.create(this.clients.requireClientId(user), user.id, dto) }; }
  @Get('campaigns/:id') async campaignGet(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.campaigns.get(this.clients.requireClientId(user), id) }; }
  @Put('campaigns/:id') @Roles(UserRole.CLIENT_ADMIN) async campaignUpdate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CampaignDto) { return { data: await this.campaigns.updateDraft(this.clients.requireClientId(user), user.id, id, dto) }; }
  @Post('campaigns/:id/duplicate') @Roles(UserRole.CLIENT_ADMIN) async campaignDuplicate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DuplicateCampaignDto) { return { data: await this.campaigns.duplicate(this.clients.requireClientId(user), user.id, id, dto.code) }; }
  @Post('campaigns/:id/activate') @Roles(UserRole.CLIENT_ADMIN) async campaignActivate(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.campaigns.transition(this.clients.requireClientId(user), user.id, id, 'activate') }; }
  @Post('campaigns/:id/pause') @Roles(UserRole.CLIENT_ADMIN) async campaignPause(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.campaigns.transition(this.clients.requireClientId(user), user.id, id, 'pause') }; }
  @Post('campaigns/:id/close') @Roles(UserRole.CLIENT_ADMIN) async campaignClose(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.campaigns.transition(this.clients.requireClientId(user), user.id, id, 'close') }; }
  @Post('campaigns/:id/cancel') @Roles(UserRole.CLIENT_ADMIN) async campaignCancel(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.campaigns.transition(this.clients.requireClientId(user), user.id, id, 'cancel') }; }
  @Get('campaigns/:id/analytics') async campaignAnalytics(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.analytics.campaign(this.clients.requireClientId(user), id) }; }
  @Get('rewards') async rewardList(@CurrentUser() user: AuthUser, @Query() query: ListRewardsDto) { return { data: await this.rewards.list(this.clients.requireClientId(user), query) }; }
  @Post('rewards/:id/approve') @Roles(UserRole.CLIENT_ADMIN) async rewardApprove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.rewards.transition(this.clients.requireClientId(user), user.id, id, 'approve') }; }
  @Post('rewards/:id/reject') @Roles(UserRole.CLIENT_ADMIN) async rewardReject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return { data: await this.rewards.transition(this.clients.requireClientId(user), user.id, id, 'reject', dto.reason) }; }
  @Post('rewards/:id/processing') @Roles(UserRole.CLIENT_ADMIN) async rewardProcessing(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.rewards.transition(this.clients.requireClientId(user), user.id, id, 'processing') }; }
  @Post('rewards/:id/paid') @Roles(UserRole.CLIENT_ADMIN) async rewardPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PayoutDto) { return { data: await this.rewards.markPaid(this.clients.requireClientId(user), user.id, id, dto.paymentReference, dto.paymentMethod) }; }
  @Get() async list(@CurrentUser() user: AuthUser, @Query() query: ListReferralsDto) { return { data: await this.referrals.listForOperations(this.clients.requireClientId(user), query) }; }
  @Get(':id') async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) { return { data: await this.referrals.detail(this.clients.requireClientId(user), id) }; }
  @Post(':id/qualify') @Roles(UserRole.CLIENT_ADMIN) async qualify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return { data: await this.qualification.manuallyQualify(this.clients.requireClientId(user), user.id, id, dto.reason) }; }
  @Post(':id/reject') @Roles(UserRole.CLIENT_ADMIN) async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) { return { data: await this.referrals.reject(this.clients.requireClientId(user), user.id, id, dto.reason) }; }
  @Post(':id/fraud/flag') @Roles(UserRole.CLIENT_ADMIN) async fraudFlag(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FraudReviewDto) { return { data: await this.fraud.review(this.clients.requireClientId(user), user.id, id, dto.checkType, dto.reason, false) }; }
  @Post(':id/fraud/clear') @Roles(UserRole.CLIENT_ADMIN) async fraudClear(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FraudReviewDto) { return { data: await this.fraud.review(this.clients.requireClientId(user), user.id, id, dto.checkType, dto.reason, true) }; }
}

/** Temporary trusted integration point until a ride/delivery event bus is available. */
@Controller('platform/clients/:clientId/referral-events')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ReferralEventController {
  constructor(private readonly qualification: ReferralQualificationService) {}
  @Post() async event(@Param('clientId') clientId: string, @Body() dto: ActivityEventDto) { return { data: await this.qualification.recordEvent(clientId, dto.riderId, dto.milestoneType, dto.sourceEventId, dto.quantity, new Date(dto.occurredAt)) }; }
}
