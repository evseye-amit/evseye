import { FleetManagerActionGuard, FleetActionResource } from '../auth/guards/fleet-manager-action.guard.js';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { InspectionsService } from './inspections.service.js';
import { CompleteInspectionDto } from './dto/complete-inspection.dto.js';

@Controller('inspections')
@UseGuards(AccessTokenGuard, RolesGuard, FleetManagerActionGuard)
@FleetActionResource('inspection')
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.FLEET_MANAGER,
)
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly audit: AuditService,
    private readonly clients: ClientContextService,
  ) {}

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') inspectionId: string) {
    return {
      data: await this.inspections.get(
        this.clients.requireClientId(user),
        inspectionId,
      ),
    };
  }

  @Post(':id/complete')
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id') inspectionId: string,
    @Body() dto?: CompleteInspectionDto,
  ) {
    const clientId = this.clients.requireClientId(user);
    const inspection = await this.inspections.complete(
      clientId,
      inspectionId,
      user,
      dto,
    );
    await this.audit.record({
      clientId,
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
