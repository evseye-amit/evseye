import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { KycVerificationStatus, KycVerificationType, UserRole } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { CreateConsentDto, CompleteAadhaarOtpDto, StartVerificationDto } from './verification.dto.js';
import { VerificationService } from './verification.service.js';
import { KycWorkflowEngine } from '../workflow/kyc-workflow.service.js';

@Controller('kyc/verifications')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class VerificationController {
  constructor(private readonly service: VerificationService, private readonly clients: ClientContextService,
    private readonly audit: AuditService, private readonly workflows: KycWorkflowEngine) {}

  @Post('consents')
  async consent(@CurrentUser() user: AuthUser, @Body() dto: CreateConsentDto) {
    const clientId = this.clients.requireClientId(user);
    const data = await this.service.consent(clientId, dto);
    await this.audit.record({ clientId, actorId: user.id, action: 'KYC_CONSENT_ACCEPTED',
      entityType: 'KYC_CONSENT', entityId: data.id,
      newData: { riderId: data.riderId, verificationType: data.verificationType } });
    return { data };
  }

  @Post()
  async start(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string,
    @Body() dto: StartVerificationDto) {
    const clientId = this.clients.requireClientId(user);
    const data = await this.service.start(clientId, key, dto);
    await this.audit.record({ clientId, actorId: user.id, action: 'KYC_VERIFICATION_REQUESTED',
      entityType: 'KYC_VERIFICATION', entityId: data.id,
      newData: { riderId: data.riderId, verificationType: data.verificationType, status: data.status } });
    return { data };
  }

  @Post(':id/aadhaar-otp')
  async completeOtp(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAadhaarOtpDto) {
    const clientId = this.clients.requireClientId(user);
    const data = await this.service.completeOtp(clientId, id, dto.otp);
    await this.workflows.syncVerification(clientId, id);
    await this.audit.record({ clientId, actorId: user.id, action: 'KYC_OTP_COMPLETED',
      entityType: 'KYC_VERIFICATION', entityId: id, newData: { status: data.status } });
    return { data };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('status') status?: KycVerificationStatus,
    @Query('type') type?: KycVerificationType, @Query('skip') skip?: string) {
    return { data: await this.service.list(this.clients.requireClientId(user), {
      status: status && Object.values(KycVerificationStatus).includes(status) ? status : undefined,
      type: type && Object.values(KycVerificationType).includes(type) ? type : undefined,
      skip: Math.max(0, Number.parseInt(skip ?? '0', 10) || 0),
    }) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.get(this.clients.requireClientId(user), id) };
  }
}
