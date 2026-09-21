import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ListRiderDocumentsDto, RejectRiderDocumentDto } from './dto/rider-document.dto.js';
import { RiderDocumentReviewService } from './rider-document-review.service.js';

@Controller('rider-documents')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER, UserRole.KYC_OPERATOR)
export class RiderDocumentReviewController {
  constructor(private readonly documents: RiderDocumentReviewService, private readonly clients: ClientContextService, private readonly audit: AuditService) {}
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListRiderDocumentsDto) {
    return { data: await this.documents.list(this.clients.requireClientId(user), query) };
  }
  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.documents.get(this.clients.requireClientId(user), id) };
  }
  @Post(':id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const clientId = this.clients.requireClientId(user); const document = await this.documents.approve(clientId, user.id, id);
    await this.audit.record({ clientId, actorId: user.id, action: 'RIDER_DOCUMENT_APPROVED', entityType: 'RIDER_ONBOARDING_DOCUMENT', entityId: id, newData: { fieldCode: document.fieldCode } });
    return { data: document };
  }
  @Post(':id/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RejectRiderDocumentDto) {
    const clientId = this.clients.requireClientId(user); const document = await this.documents.reject(clientId, user.id, id, body.rejectionReason);
    await this.audit.record({ clientId, actorId: user.id, action: 'RIDER_DOCUMENT_REJECTED', entityType: 'RIDER_ONBOARDING_DOCUMENT', entityId: id, newData: { fieldCode: document.fieldCode, rejectionReason: document.rejectionReason ?? '' } });
    return { data: document };
  }
}
