import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import {
  ProviderSettlementService,
  type SettlementImport,
} from './provider-settlement.service.js';

@Controller('client/finance/provider-settlements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class ProviderSettlementController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly settlements: ProviderSettlementService,
  ) {}
  @Post('imports') importReport(
    @CurrentUser() user: AuthUser,
    @Body() body: SettlementImport,
  ) {
    return this.settlements.importReport(
      this.clients.requireClientId(user),
      user.id,
      body,
    );
  }
  @Get() list(@CurrentUser() user: AuthUser) {
    return this.settlements.list(this.clients.requireClientId(user));
  }
  @Get(':id') detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settlements.detail(this.clients.requireClientId(user), id);
  }
}
