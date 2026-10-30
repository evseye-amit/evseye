import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ListRiderReferencesDto, RejectRiderReferenceDto } from './dto/rider-reference.dto.js';
import { RiderReferenceReviewService } from './rider-reference-review.service.js';

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.FLEET_MANAGER, UserRole.KYC_OPERATOR)
export class RiderReferenceReviewController {
  constructor(private readonly references: RiderReferenceReviewService, private readonly clients: ClientContextService, private readonly audit: AuditService) {}

  @Get('rider-references')
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRiderReferencesDto) {
    return { data: await this.references.list(this.clients.requireClientId(user), query) };
  }

  @Get('riders/:id/references')
  async forRider(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.references.forRider(this.clients.requireClientId(user), id) };
  }

  @Post('rider-references/:id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.review(user, id, 'APPROVED');
  }

  @Post('rider-references/:id/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RejectRiderReferenceDto) {
    return this.review(user, id, 'REJECTED', body.rejectionReason);
  }

  private async review(user: AuthUser, id: string, status: 'APPROVED' | 'REJECTED', reason?: string) {
    const clientId = this.clients.requireClientId(user);
    const reference = await this.references.review(clientId, user.id, id, status, reason);
    await this.audit.record({ clientId, actorId: user.id, action: `RIDER_REFERENCE_${status}`, entityType: 'RIDER_REFERENCE', entityId: id,
      newData: { riderId: reference.riderId, userId: reference.userId, status, rejectionReason: reference.rejectionReason } });
    return { data: reference };
  }
}
