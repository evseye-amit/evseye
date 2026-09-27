import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { KycCommercialService } from './kyc-commercial.service.js';

@Controller('platform/kyc/commercial')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class KycPlatformCommercialController {
  constructor(private readonly prisma: PrismaService, private readonly commercial: KycCommercialService,
    private readonly audit: AuditService) {}

  @Get('clients/:clientId/usage')
  async usage(@Param('clientId', ParseUUIDPipe) clientId: string, @Query('skip') skip = '0') {
    const offset = Math.max(0, Math.min(100000, Number(skip) || 0));
    return { data: await this.prisma.featureUsageConsumption.findMany({ where: { clientId },
      include: { feature: { select: { code: true, name: true } } },
      orderBy: { occurredAt: 'desc' }, skip: offset, take: 50 }) };
  }

  @Post('clients/:clientId/usage/:verificationId/reverse')
  async reverse(@Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('verificationId', ParseUUIDPipe) verificationId: string,
    @Body('reason') reason: string, @CurrentUser() user: AuthUser) {
    const usage = await this.commercial.reverse(clientId, verificationId, reason ?? '');
    await this.audit.record({ clientId, actorId: user.id, action: 'KYC_USAGE_REVERSED',
      entityType: 'FEATURE_USAGE_CONSUMPTION', entityId: usage.id, newData: { verificationId, reason } });
    return { data: usage };
  }
}
