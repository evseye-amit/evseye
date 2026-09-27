import { BadRequestException, Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { KycVerificationType, Prisma, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../../audit/audit.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRegistryService } from '../verification/provider-registry.service.js';
import { KycProviderHealthService } from './kyc-provider-health.service.js';
import { KycProviderScoringService, validateWeights } from './kyc-provider-scoring.service.js';

class PolicyDto {
  @IsString() @Matches(/^[A-Z0-9_]{3,80}$/) code!: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsIn(Object.values(KycVerificationType)) verificationType!: KycVerificationType;
  @IsIn(['STATIC', 'RULE_BASED', 'SCORED', 'SHADOW']) mode!: string;
  @IsObject() weights!: Record<string, number>;
  @Type(() => Number) @IsInt() @Min(15) @Max(10080) observationWindowMinutes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) minimumSampleSize!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) maxSnapshotAgeMinutes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(120000) latencyTargetMs!: number;
  @IsIn(['NEUTRAL', 'EXCLUDE']) unknownCostBehavior!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) rolloutPercent!: number;
  @IsOptional() @IsUUID() sourceShadowPolicyId?: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsString() @Matches(/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/) maxTechnicalFailurePercent?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxP95LatencyMs?: number;
  @IsString() @MinLength(10) @MaxLength(500) reason!: string;
}
class StateDto { @IsString() @MinLength(10) @MaxLength(500) reason!: string; @IsBoolean() confirm!: boolean; }
class ControlDto extends StateDto {
  @Matches(/^(GLOBAL|TYPE:(PAN_VERIFICATION|AADHAAR_OTP|AADHAAR_OKYC|BANK_ACCOUNT_VERIFICATION|IFSC_VERIFICATION|PAN_AADHAAR_LINK|DIGILOCKER|NAME_MATCH|FACE_MATCH|LIVENESS)|CLIENT:[0-9a-fA-F-]{36})$/) scopeKey!: string;
  @IsBoolean() disabled!: boolean;
}

@Controller('platform/kyc/intelligent-routing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class KycIntelligentRoutingController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly registry: ProviderRegistryService, private readonly health: KycProviderHealthService,
    private readonly scoring: KycProviderScoringService) {}

  @Get('policies') async policies() {
    return { data: await this.prisma.kycIntelligentRoutingPolicy.findMany({
      orderBy: [{ createdAt: 'desc' }], take: 100 }) };
  }
  @Get('controls') async controls() {
    return { data: await this.prisma.kycIntelligentRoutingControl.findMany({ orderBy: { scopeKey: 'asc' } }) };
  }
  @Post('policies') async create(@Body() dto: PolicyDto, @CurrentUser() user: AuthUser) {
    validateWeights(dto.weights);
    if (dto.mode === 'SHADOW' && dto.rolloutPercent !== 0 || dto.mode === 'SCORED' && !dto.sourceShadowPolicyId)
      throw new BadRequestException('KYC_INVALID_INTELLIGENT_ROLLOUT');
    if (dto.clientId && !await this.prisma.client.findUnique({ where: { id: dto.clientId }, select: { id: true } }))
      throw new BadRequestException('KYC_CLIENT_NOT_FOUND');
    const latest = await this.prisma.kycIntelligentRoutingPolicy.findFirst({ where: {
      code: dto.code, clientId: dto.clientId ?? null }, orderBy: { version: 'desc' } });
    const created = await this.prisma.kycIntelligentRoutingPolicy.create({ data: {
      code: dto.code, version: (latest?.version ?? 0) + 1, clientId: dto.clientId ?? null,
      verificationType: dto.verificationType, mode: dto.mode, status: 'DRAFT',
      weights: dto.weights, observationWindowMinutes: dto.observationWindowMinutes,
      minimumSampleSize: dto.minimumSampleSize, maxSnapshotAgeMinutes: dto.maxSnapshotAgeMinutes,
      latencyTargetMs: dto.latencyTargetMs, unknownCostBehavior: dto.unknownCostBehavior,
      rolloutPercent: dto.rolloutPercent, sourceShadowPolicyId: dto.sourceShadowPolicyId,
      maxTechnicalFailurePercent: dto.maxTechnicalFailurePercent,
      maxP95LatencyMs: dto.maxP95LatencyMs,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(), createdBy: user.id,
    } });
    await this.audit.record({ actorId: user.id, action: 'KYC_INTELLIGENT_POLICY_CREATED',
      entityType: 'KYC_INTELLIGENT_ROUTING_POLICY', entityId: created.id,
      newData: { code: created.code, version: created.version, mode: created.mode, reason: dto.reason } });
    return { data: created };
  }

  @Patch('policies/:id/activate') async activate(@Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StateDto, @CurrentUser() user: AuthUser) {
    if (!dto.confirm) throw new BadRequestException('KYC_CONFIRMATION_REQUIRED');
    const policy = await this.prisma.kycIntelligentRoutingPolicy.findUniqueOrThrow({ where: { id } });
    if (!['DRAFT', 'PAUSED'].includes(policy.status)) throw new ConflictException('KYC_POLICY_NOT_ACTIVATABLE');
    if (policy.mode === 'SCORED') {
      const shadow = policy.sourceShadowPolicyId ? await this.prisma.kycIntelligentRoutingPolicy.findUnique({
        where: { id: policy.sourceShadowPolicyId } }) : null;
      if (!shadow || shadow.mode !== 'SHADOW' || shadow.code !== policy.code || shadow.clientId !== policy.clientId ||
        shadow.verificationType !== policy.verificationType || shadow.environment !== policy.environment ||
        await this.prisma.kycShadowDecision.count({ where: { policyId: shadow.id } }) < policy.minimumSampleSize)
        throw new ConflictException('KYC_SHADOW_EVIDENCE_REQUIRED');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.kycIntelligentRoutingPolicy.updateMany({ where: { clientId: policy.clientId,
        verificationType: policy.verificationType, environment: policy.environment, status: 'ACTIVE' },
      data: { status: 'RETIRED' } });
      await tx.kycIntelligentRoutingPolicy.update({ where: { id }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'KYC_INTELLIGENT_POLICY_ACTIVATED',
        entityType: 'KYC_INTELLIGENT_ROUTING_POLICY', entityId: id,
        newData: { mode: policy.mode, version: policy.version, rolloutPercent: policy.rolloutPercent,
          reason: dto.reason } } });
    });
    return { data: { id, status: 'ACTIVE' } };
  }

  @Patch('policies/:id/pause') async pause(@Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StateDto, @CurrentUser() user: AuthUser) {
    if (!dto.confirm) throw new BadRequestException('KYC_CONFIRMATION_REQUIRED');
    const changed = await this.prisma.kycIntelligentRoutingPolicy.updateMany({ where: { id, status: 'ACTIVE' },
      data: { status: 'PAUSED' } });
    if (!changed.count) throw new ConflictException('KYC_POLICY_NOT_ACTIVE');
    await this.audit.record({ actorId: user.id, action: 'KYC_INTELLIGENT_POLICY_PAUSED',
      entityType: 'KYC_INTELLIGENT_ROUTING_POLICY', entityId: id, newData: { reason: dto.reason } });
    return { data: { id, status: 'PAUSED' } };
  }

  @Patch('controls') async setControl(@Body() dto: ControlDto, @CurrentUser() user: AuthUser) {
    if (!dto.confirm) throw new BadRequestException('KYC_CONFIRMATION_REQUIRED');
    if (dto.scopeKey.startsWith('CLIENT:') && !await this.prisma.client.findUnique({
      where: { id: dto.scopeKey.slice(7) }, select: { id: true } })) throw new BadRequestException('KYC_CLIENT_NOT_FOUND');
    const control = await this.prisma.kycIntelligentRoutingControl.upsert({ where: { scopeKey: dto.scopeKey },
      create: { scopeKey: dto.scopeKey, disabled: dto.disabled, reason: dto.reason, updatedBy: user.id },
      update: { disabled: dto.disabled, reason: dto.reason, updatedBy: user.id } });
    await this.audit.record({ actorId: user.id, action: 'KYC_INTELLIGENT_KILL_SWITCH_CHANGED',
      entityType: 'KYC_INTELLIGENT_ROUTING_CONTROL', entityId: dto.scopeKey,
      newData: { disabled: dto.disabled, reason: dto.reason } });
    return { data: control };
  }

  @Get('policies/:id/preview') async preview(@Param('id', ParseUUIDPipe) id: string,
    @Query('clientId') clientId?: string) {
    const policy = await this.prisma.kycIntelligentRoutingPolicy.findUniqueOrThrow({ where: { id } });
    const scope = clientId ?? policy.clientId;
    if (!scope) throw new BadRequestException('KYC_PREVIEW_CLIENT_REQUIRED');
    const eligible = await this.registry.eligible(scope, policy.verificationType, policy.environment);
    const health = await Promise.all(eligible.map(async (candidate) => {
      const state = await this.health.snapshot(candidate.config.id, candidate.config.code, policy.verificationType);
      return { providerId: candidate.config.id, status: state.status, circuitOpen: state.circuitOpen };
    }));
    return { data: await this.scoring.score(eligible, policy, health) };
  }

  @Get('shadow') async shadow(@Query('policyId', new ParseUUIDPipe({ optional: true })) policyId?: string) {
    const where = policyId ? { policyId } : {};
    const [items, total, agreement] = await Promise.all([
      this.prisma.kycShadowDecision.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.kycShadowDecision.count({ where }),
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`SELECT COUNT(*)::int AS count FROM "KycShadowDecision"
        WHERE "actualProviderId" = "shadowProviderId" ${policyId ? Prisma.sql`AND "policyId" = ${policyId}` : Prisma.empty}`),
    ]);
    return { data: { items, total, agreement: agreement[0]?.count ?? 0,
      agreementRate: total ? (agreement[0]?.count ?? 0) / total : null } };
  }

  @Get('readiness') async readiness() {
    const providers = await this.prisma.kycProviderConfig.findMany({ include: {
      capabilities: true, credentials: { select: { environment: true, status: true, validFrom: true, validUntil: true } } } });
    const now = new Date();
    const data = await Promise.all(providers.flatMap((provider) => provider.capabilities.map(async (capability) => {
      const sla = await this.prisma.kycProviderSlaPolicy.count({ where: { providerId: provider.id,
        OR: [{ verificationType: capability.verificationType }, { verificationType: null }],
        status: 'ACTIVE', effectiveFrom: { lte: now }, AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }] } });
      const health = await this.health.snapshot(provider.id, provider.code, capability.verificationType);
      return { providerId: provider.id, provider: provider.name, environment: provider.environment,
        verificationType: capability.verificationType, active: provider.isActive && capability.isEnabled,
        credentialConfigured: provider.credentials.some((credential) => credential.environment === provider.environment &&
          credential.status === 'ACTIVE' && (!credential.validFrom || credential.validFrom <= now) &&
          (!credential.validUntil || credential.validUntil > now)),
        timeoutMs: capability.timeoutMs, maxRetries: capability.maxRetries,
        costConfigured: capability.costPerRequest !== null && capability.billingRule !== 'UNKNOWN',
        slaConfigured: sla > 0, health: health.status, circuitOpen: health.circuitOpen };
    })));
    return { data };
  }
}
