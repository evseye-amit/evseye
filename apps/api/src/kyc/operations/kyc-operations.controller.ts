import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { KycRoutingStrategy, KycVerificationType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderRegistryService } from '../verification/provider-registry.service.js';
import { StartVerificationDto } from '../verification/verification.dto.js';
import { KycProviderHealthService } from '../routing/kyc-provider-health.service.js';
import { KycOperationalAlertService } from './kyc-operational-alert.service.js';
import { KycOperationsCommandService } from './kyc-operations-command.service.js';
import { KycOperationsQueryService } from './kyc-operations-query.service.js';

class QueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(168) hours?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) skip?: number;
  @IsOptional() @IsString() @MaxLength(80) status?: string;
  @IsOptional() @IsString() @MaxLength(80) type?: string;
  @IsOptional() @IsUUID() providerId?: string;
  @IsOptional() @IsIn(['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'RATE_LIMITED',
    'AUTHENTICATION_FAILED', 'INVALID_INPUT', 'IDENTITY_MISMATCH', 'OTP_FAILED', 'DOCUMENT_INVALID',
    'PAN_NOT_VERIFIED']) failureCategory?: string;
  @IsOptional() @IsIn(Object.values(KycRoutingStrategy)) strategy?: KycRoutingStrategy;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(60) flag?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'activity']) sort?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(80) entityType?: string;
  @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsUUID() clientId?: string;
}
class AssignmentDto {
  @IsOptional() @IsUUID() assignedTo?: string | null;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
class ReviewActionDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
class PriorityDto {
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']) priority!: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
class RecoveryDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
class RetryDto extends RecoveryDto {
  @ValidateNested() @Type(() => StartVerificationDto) input!: StartVerificationDto;
}
class ProviderStateDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsIn(Object.values(KycVerificationType)) capability?: KycVerificationType;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

@Controller('kyc/operations')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycClientOperationsController {
  constructor(private readonly clients: ClientContextService, private readonly query: KycOperationsQueryService,
    private readonly commands: KycOperationsCommandService, private readonly alerts: KycOperationalAlertService,
    private readonly prisma: PrismaService, private readonly health: KycProviderHealthService) {}

  @Get('summary') summary(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.summary(this.clients.requireClientId(user), q.hours).then((data) => ({ data }));
  }
  @Get('verifications') verifications(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.verifications({ ...q, clientId: this.clients.requireClientId(user) }).then((data) => ({ data }));
  }
  @Get('verifications/:id') verification(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.verificationDetail(id, this.clients.requireClientId(user)).then((data) => ({ data }));
  }
  @Get('verifications/:id/recovery-options') recoveryOptions(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string) {
    return this.commands.retryPreview(this.clients.requireClientId(user), id).then((data) => ({ data }));
  }
  @Post('verifications/:id/retry')
  @Roles(UserRole.CLIENT_ADMIN)
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string, @Body() dto: RetryDto) {
    return this.commands.retry(this.clients.requireClientId(user), id, user.id, key,
      dto.input, dto.expectedVersion, dto.reason).then((data) => ({ data }));
  }
  @Get('workflows') workflows(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.workflows({ ...q, clientId: this.clients.requireClientId(user) }).then((data) => ({ data }));
  }
  @Get('workflows/:id') workflow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.workflowDetail(id, this.clients.requireClientId(user)).then((data) => ({ data }));
  }
  @Get('manual-reviews') reviews(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.manualReviews({ ...q, clientId: this.clients.requireClientId(user) }, user.id).then((data) => ({ data }));
  }
  @Patch('manual-reviews/:id/assignment') assign(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentDto) {
    const clientId = this.clients.requireClientId(user);
    const assignee = user.roles.includes(UserRole.CLIENT_ADMIN) ? dto.assignedTo ?? null : user.id;
    return this.commands.assign(clientId, id, user.id, assignee, dto.expectedVersion, dto.reason,
      user.roles.includes(UserRole.CLIENT_ADMIN)).then((data) => ({ data }));
  }
  @Post('manual-reviews/:id/resolve') resolve(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewActionDto) {
    return this.commands.review(this.clients.requireClientId(user), id, user.id, dto.action,
      dto.expectedVersion, dto.reason).then((data) => ({ data }));
  }
  @Patch('manual-reviews/:id/priority')
  @Roles(UserRole.CLIENT_ADMIN)
  priority(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: PriorityDto) {
    return this.commands.priority(this.clients.requireClientId(user), id, user.id, dto.priority,
      dto.expectedVersion, dto.reason).then((data) => ({ data }));
  }
  @Get('workflows/:id/recovery-options') workflowRecovery(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string) {
    return this.commands.recoveryPreview(this.clients.requireClientId(user), id).then((data) => ({ data }));
  }
  @Post('workflows/:id/resume')
  @Roles(UserRole.CLIENT_ADMIN)
  resume(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecoveryDto) {
    return this.commands.resume(this.clients.requireClientId(user), id, user.id,
      dto.expectedVersion, dto.reason).then((data) => ({ data }));
  }
  @Get('providers') async providers(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const rows = await this.prisma.kycProviderConfig.findMany({ select: { id: true, code: true, name: true,
      environment: true, isActive: true, capabilities: { select: { verificationType: true, isEnabled: true } } } })
    return { data: await Promise.all(rows.map(async (row) => ({ ...row,
      capabilities: await Promise.all(row.capabilities.map(async (capability) => ({ ...capability,
        health: await this.health.snapshot(row.id, row.code, capability.verificationType, clientId) }))) }))) };
  }
  @Get('alerts') alertList(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.alerts.list(this.clients.requireClientId(user), q.status, q.skip).then((data) => ({ data }));
  }
  @Get('audit') audit(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.audit({ ...q, clientId: this.clients.requireClientId(user) }).then((data) => ({ data }));
  }
}

@Controller('platform/kyc/operations')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class KycPlatformOperationsController {
  constructor(private readonly query: KycOperationsQueryService, private readonly commands: KycOperationsCommandService,
    private readonly alerts: KycOperationalAlertService, private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService, private readonly health: KycProviderHealthService) {}

  @Get('summary') summary(@Query() q: QueryDto) { return this.query.summary(q.clientId, q.hours).then((data) => ({ data })); }
  @Get('verifications') verifications(@Query() q: QueryDto) {
    return this.query.verifications(q).then((data) => ({ data }));
  }
  @Get('verifications/:id') verification(@Param('id', ParseUUIDPipe) id: string, @Query() q: QueryDto) {
    return this.query.verificationDetail(id, q.clientId, true).then((data) => ({ data }));
  }
  @Get('workflows') workflows(@Query() q: QueryDto) { return this.query.workflows(q).then((data) => ({ data })); }
  @Get('workflows/:id') workflow(@Param('id', ParseUUIDPipe) id: string, @Query() q: QueryDto) {
    return this.query.workflowDetail(id, q.clientId).then((data) => ({ data }));
  }
  @Get('manual-reviews') reviews(@CurrentUser() user: AuthUser, @Query() q: QueryDto) {
    return this.query.manualReviews(q, user.id).then((data) => ({ data }));
  }
  @Get('providers') async providers() {
    const rows = await this.prisma.kycProviderConfig.findMany({ select: { id: true, code: true, name: true,
      environment: true, isActive: true, capabilities: { select: { verificationType: true, isEnabled: true } } } });
    return { data: await Promise.all(rows.map(async (row) => ({ ...row,
      health: row.isActive ? await this.registry.health(row.code) : 'UNAVAILABLE',
      circuitOpen: this.registry.circuitOpen(row.code),
      capabilities: await Promise.all(row.capabilities.map(async (capability) => ({ ...capability,
        health: await this.health.snapshot(row.id, row.code, capability.verificationType) }))) }))) };
  }
  @Patch('providers/:id/state') state(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProviderStateDto) {
    return this.commands.providerState(id, user.id, dto.enabled, dto.reason, dto.capability).then((data) => ({ data }));
  }
  @Get('alerts') alertList(@Query() q: QueryDto) {
    return this.alerts.list(q.clientId, q.status, q.skip).then((data) => ({ data }));
  }
  @Post('alerts/:id/acknowledge') acknowledge(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.change(id, undefined, user.id, 'ACKNOWLEDGED').then((data) => ({ data }));
  }
  @Post('alerts/:id/resolve') resolve(@CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.change(id, undefined, user.id, 'RESOLVED').then((data) => ({ data }));
  }
  @Get('audit') audit(@Query() q: QueryDto) { return this.query.audit(q).then((data) => ({ data })); }
}
