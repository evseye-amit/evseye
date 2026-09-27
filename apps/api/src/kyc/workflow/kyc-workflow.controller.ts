import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { KycWorkflowStatus, UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ClientContextService } from '../../auth/client-context.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { StartVerificationDto } from '../verification/verification.dto.js';
import { KycWorkflowEngine } from './kyc-workflow.service.js';

class StartWorkflowDto {
  @IsUUID() riderId!: string;
  @IsOptional() @IsString() @MaxLength(80) workflowCode?: string;
  @IsOptional() @IsBoolean() reverify?: boolean;
}
class ReviewDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

@Controller('kyc/workflows')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycWorkflowController {
  constructor(private readonly engine: KycWorkflowEngine, private readonly clients: ClientContextService) {}

  @Post('start')
  async start(@CurrentUser() user: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body() dto: StartWorkflowDto) {
    return { data: await this.engine.start(this.clients.requireClientId(user), dto.riderId, dto.workflowCode, key, dto.reverify) };
  }

  @Post(':id/steps/current')
  async step(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartVerificationDto) {
    return { data: await this.engine.submitStep(this.clients.requireClientId(user), id, dto) };
  }

  @Get('riders/:riderId/status')
  async riderStatus(@CurrentUser() user: AuthUser, @Param('riderId', ParseUUIDPipe) riderId: string) {
    return { data: await this.engine.riderStatus(this.clients.requireClientId(user), riderId) };
  }

  @Get('riders/:riderId/current')
  async current(@CurrentUser() user: AuthUser, @Param('riderId', ParseUUIDPipe) riderId: string) {
    return { data: await this.engine.currentForRider(this.clients.requireClientId(user), riderId) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.engine.get(this.clients.requireClientId(user), id) };
  }
}

@Controller('kyc/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycWorkflowAdminController {
  constructor(private readonly engine: KycWorkflowEngine, private readonly clients: ClientContextService) {}

  @Get('workflows')
  async list(@CurrentUser() user: AuthUser, @Query('status') status?: KycWorkflowStatus, @Query('skip') skip?: string,
    @Query('workflowCode') workflowCode?: string, @Query('startedFrom') startedFrom?: string, @Query('startedTo') startedTo?: string) {
    return { data: await this.engine.list(this.clients.requireClientId(user),
      status && Object.values(KycWorkflowStatus).includes(status) ? status : undefined,
      Math.max(0, Number.parseInt(skip ?? '0', 10) || 0), workflowCode?.slice(0, 80),
      startedFrom && !Number.isNaN(Date.parse(startedFrom)) ? new Date(startedFrom) : undefined,
      startedTo && !Number.isNaN(Date.parse(startedTo)) ? new Date(startedTo) : undefined) };
  }

  @Get('workflows/:id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.engine.get(this.clients.requireClientId(user), id) };
  }

  @Get('workflow-definitions')
  async definitions(@CurrentUser() user: AuthUser) {
    return { data: await this.engine.definitions(this.clients.requireClientId(user)) };
  }

  @Get('workflow-definitions/:id')
  async definition(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.engine.definition(this.clients.requireClientId(user), id) };
  }

  @Get('manual-reviews')
  async reviews(@CurrentUser() user: AuthUser, @Query('skip') skip?: string) {
    return { data: await this.engine.list(this.clients.requireClientId(user), 'MANUAL_REVIEW',
      Math.max(0, Number.parseInt(skip ?? '0', 10) || 0)) };
  }

  @Get('manual-reviews/:id')
  async reviewDetail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.engine.get(this.clients.requireClientId(user), id) };
  }

  @Post('manual-reviews/:id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return { data: await this.engine.review(this.clients.requireClientId(user), id, user.id, true, dto.reason) };
  }

  @Post('manual-reviews/:id/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return { data: await this.engine.review(this.clients.requireClientId(user), id, user.id, false, dto.reason) };
  }
}
