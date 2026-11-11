import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { ListAuditDto } from './list-audit.dto.js';
import { AuditService } from './audit.service.js';
@Controller('audit-logs')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async list(@CurrentUser() u: AuthUser, @Query() query: ListAuditDto) {
    return {
      data: await this.audit.list(
        this.clients.requireClientId(u),
        query.page,
        query.pageSize,
        query,
      ),
    };
  }
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() u: AuthUser, @Query() query: ListAuditDto) {
    const result = await this.audit.list(this.clients.requireClientId(u), 1, 100, query);
    const headers = ['createdAt', 'actorId', 'action', 'entityType', 'entityId', 'requestId'];
    const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    return [headers.join(','), ...result.items.map((item) => headers.map((header) => cell((item as Record<string, unknown>)[header])).join(','))].join('\n');
  }
}
