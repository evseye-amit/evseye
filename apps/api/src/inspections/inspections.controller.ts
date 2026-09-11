import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { InspectionsService } from './inspections.service.js';

@Controller('inspections')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.TENANT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly audit: AuditService,
    private readonly tenants: TenantContextService,
  ) {}

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') inspectionId: string) {
    return {
      data: await this.inspections.get(
        this.tenants.requireTenantId(user),
        inspectionId,
      ),
    };
  }

  @Post(':id/complete')
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id') inspectionId: string,
  ) {
    const tenantId = this.tenants.requireTenantId(user);
    const inspection = await this.inspections.complete(
      tenantId,
      inspectionId,
      user.id,
    );
    await this.audit.record({
      tenantId,
      actorId: user.id,
      action: 'INSPECTION_COMPLETED',
      entityType: 'INSPECTION',
      entityId: inspectionId,
      newData: {
        allocationId: inspection.allocationId,
        type: inspection.type,
        status: inspection.status,
      },
    });
    return {
      data: inspection,
    };
  }
}
