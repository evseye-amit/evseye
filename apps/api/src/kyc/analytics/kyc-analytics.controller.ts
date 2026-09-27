import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { KycRoutingStrategy, KycVerificationType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycAnalyticsService } from './kyc-analytics.service.js';
import { KycSlaAnalyticsService, SlaPolicyInput } from './kyc-sla-analytics.service.js';

const decimalPattern = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;

export class KycAnalyticsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() providerId?: string;
  @IsOptional() @IsIn(Object.values(KycVerificationType)) verificationType?: KycVerificationType;
  @IsOptional() @IsIn(Object.values(KycRoutingStrategy)) strategy?: KycRoutingStrategy;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}

class SlaPolicyDto implements SlaPolicyInput {
  @IsUUID() providerId!: string;
  @IsOptional() @IsIn(Object.values(KycVerificationType)) verificationType?: KycVerificationType;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveUntil?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) availabilityTarget?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) technicalSuccessTarget?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) timeoutRateTarget?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120000) p95LatencyTargetMs?: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) minimumSampleSize!: number;
  @IsOptional() @IsString() @MaxLength(150) contractReference?: string;
}

class ProviderCostDto {
  @IsOptional() @IsString() @Matches(/^\d{1,8}(?:\.\d{1,4})?$/) costPerRequest?: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['UNKNOWN', 'EVERY_ATTEMPT', 'TECHNICAL_COMPLETION', 'BUSINESS_SUCCESS']) billingRule!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

class CloseSlaDto { @IsDateString() effectiveUntil!: string; }

@Controller('platform/kyc/analytics')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class KycPlatformAnalyticsController {
  constructor(private readonly analytics: KycAnalyticsService, private readonly sla: KycSlaAnalyticsService,
    private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  @Get('overview') overview(@Query() q: KycAnalyticsQueryDto) { return this.analytics.overview(q, true).then((data) => ({ data })); }
  @Get('cost') cost(@Query() q: KycAnalyticsQueryDto) { return this.analytics.cost(q).then((data) => ({ data })); }
  @Get('commercial') commercial(@Query() q: KycAnalyticsQueryDto) { return this.analytics.commercial(q).then((data) => ({ data })); }
  @Get('providers') providers(@Query() q: KycAnalyticsQueryDto) { return this.analytics.providers(q).then((data) => ({ data })); }
  @Get('routing') routing(@Query() q: KycAnalyticsQueryDto) { return this.analytics.routing(q).then((data) => ({ data })); }
  @Get('sla') slaReport(@Query() q: KycAnalyticsQueryDto) { return this.sla.evaluate(q).then((data) => ({ data })); }
  @Get('data-quality') quality(@Query() q: KycAnalyticsQueryDto) { return this.analytics.quality(q).then((data) => ({ data })); }
  @Post('sla/policies') createPolicy(@Body() dto: SlaPolicyDto, @CurrentUser() user: AuthUser) {
    return this.sla.createPolicy(dto, user.id).then((data) => ({ data }));
  }
  @Patch('sla/policies/:id/close') closePolicy(@Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSlaDto, @CurrentUser() user: AuthUser) {
    return this.sla.closePolicy(id, dto.effectiveUntil, user.id).then((data) => ({ data }));
  }
  @Patch('providers/:providerId/capabilities/:type/cost')
  async providerCost(@Param('providerId', ParseUUIDPipe) providerId: string, @Param('type') type: KycVerificationType,
    @Body() dto: ProviderCostDto, @CurrentUser() user: AuthUser) {
    if (!Object.values(KycVerificationType).includes(type)) throw new BadRequestException('KYC_INVALID_VERIFICATION_TYPE');
    const before = await this.prisma.kycProviderCapability.findUniqueOrThrow({ where: {
      providerId_verificationType: { providerId, verificationType: type } } });
    const after = await this.prisma.kycProviderCapability.update({ where: { id: before.id }, data: {
      costPerRequest: dto.costPerRequest ?? null, currency: dto.currency, billingRule: dto.billingRule } });
    await this.audit.record({ actorId: user.id, action: 'KYC_PROVIDER_COST_CONFIGURED', entityType: 'KYC_PROVIDER_CAPABILITY',
      entityId: after.id, previousData: { costPerRequest: before.costPerRequest?.toString() ?? null,
        currency: before.currency, billingRule: before.billingRule },
      newData: { costPerRequest: after.costPerRequest?.toString() ?? null,
        currency: after.currency, billingRule: after.billingRule, reason: dto.reason } });
    return { data: { providerId, verificationType: type, costPerRequest: after.costPerRequest,
      currency: after.currency, billingRule: after.billingRule } };
  }
}

@Controller('kyc/analytics')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycClientAnalyticsController {
  constructor(private readonly analytics: KycAnalyticsService, private readonly clients: ClientContextService) {}
  @Get('overview') overview(@CurrentUser() user: AuthUser, @Query() q: KycAnalyticsQueryDto) {
    return this.analytics.overview({ ...q, clientId: this.clients.requireClientId(user) }, false).then((data) => ({ data }));
  }
}
