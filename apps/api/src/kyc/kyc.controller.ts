import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { CompleteKycDto } from './dto/complete-kyc.dto.js';
import { StartKycDto } from './dto/start-kyc.dto.js';
import { KycService } from './kyc.service.js';

@Controller('riders/:riderId/kyc')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.KYC_OPERATOR)
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly audit: AuditService,
    private readonly tenants: TenantContextService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) {
    return {
      data: await this.kyc.list(this.tenants.requireTenantId(user), riderId),
    };
  }

  @Post()
  async start(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Body() dto: StartKycDto,
  ) {
    const tenantId = this.tenants.requireTenantId(user);
    const verification = await this.kyc.start(tenantId, riderId, dto);
    await this.audit.record({
      tenantId,
      actorId: user.id,
      action: 'KYC_STARTED',
      entityType: 'RIDER_KYC',
      entityId: verification.id,
      newData: {
        riderId,
        type: verification.type,
        status: verification.status,
      },
    });
    return {
      data: verification,
    };
  }

  @Patch(':kycId')
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Param('kycId') kycId: string,
    @Body() dto: CompleteKycDto,
  ) {
    const tenantId = this.tenants.requireTenantId(user);
    const verification = await this.kyc.complete(tenantId, riderId, kycId, dto);
    await this.audit.record({
      tenantId,
      actorId: user.id,
      action: 'KYC_STATUS_CHANGED',
      entityType: 'RIDER_KYC',
      entityId: verification.id,
      newData: {
        riderId,
        type: verification.type,
        status: verification.status,
      },
    });
    return {
      data: verification,
    };
  }
}
