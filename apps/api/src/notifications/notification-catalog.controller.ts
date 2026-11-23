import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  NotificationCatalogService,
  notificationApplications,
  type NotificationApplication,
} from './notification-catalog.service.js';

export class NotificationCatalogQuery {
  @IsIn(notificationApplications) application!: NotificationApplication;
}
@Controller('app/notification-catalog')
@ApiTags('App Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.RIDER,
  UserRole.FLEET_MANAGER,
  UserRole.TEAM_LEAD,
  UserRole.CLIENT_ADMIN,
  UserRole.KYC_OPERATOR,
  UserRole.ADVISOR,
  UserRole.QC_MANAGER,
)
export class NotificationCatalogController {
  constructor(
    private readonly catalog: NotificationCatalogService,
    private readonly clients: ClientContextService,
  ) {}
  @Get()
  async get(
    @CurrentUser() actor: AuthUser,
    @Query() query: NotificationCatalogQuery,
  ) {
    this.clients.requireClientId(actor);
    return { data: await this.catalog.applicable(actor, query.application) };
  }
}
