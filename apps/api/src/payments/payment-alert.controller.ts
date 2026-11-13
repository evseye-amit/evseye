import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { operationsPage } from './operations-pagination.js';
import { PaymentAlertService } from './payment-alert.service.js';
@Controller('client/finance/payment-alerts')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class PaymentAlertController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly alerts: PaymentAlertService,
  ) {}
  @Get('assignees') assignees(@CurrentUser() user: AuthUser) {
    return this.alerts.assignees(this.clients.requireClientId(user));
  }
  @Get() list(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    return this.alerts.list(
      this.clients.requireClientId(user),
      operationsPage(page),
    );
  }
  @Post(':id/route') route(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { assigneeId?: string; acknowledge?: boolean },
  ) {
    return this.alerts.route(
      this.clients.requireClientId(user),
      id,
      user.id,
      body.assigneeId ?? null,
      body.acknowledge === true,
    );
  }
}
