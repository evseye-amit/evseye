import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { AuditService } from './audit.service.js';
@Controller('audit-logs')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.TENANT_ADMIN)
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly tenants: TenantContextService,
  ) {}
  @Get() async list(
    @CurrentUser() u: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const requestedPage = Math.max(Number(page) || 1, 1);
    const requestedPageSize = Math.min(
      Math.max(Number(pageSize) || 50, 1),
      100,
    );
    return {
      data: await this.audit.list(
        this.tenants.requireTenantId(u),
        requestedPage,
        requestedPageSize,
      ),
    };
  }
}
