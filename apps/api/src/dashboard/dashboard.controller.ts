import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { DashboardService } from './dashboard.service.js';
@Controller('dashboard')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(
  UserRole.CLIENT_ADMIN,
  UserRole.OPERATIONS_MANAGER,
  UserRole.FLEET_MANAGER,
)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly clients: ClientContextService,
  ) {}
  @Get() async summary(@CurrentUser() u: AuthUser) {
    return {
      data: await this.dashboard.summary(this.clients.requireClientId(u)),
    };
  }
}
