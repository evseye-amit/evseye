import { SettlementIngestionService } from './settlement-ingestion.service.js';
import { operationsPage } from './operations-pagination.js';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
    private readonly ingestion: SettlementIngestionService,
  ) {}
  @Get('merchant-versions') versions(@CurrentUser() user: AuthUser) { return this.ingestion.versions(this.clients.requireClientId(user)); }
  @Post('fetch') fetch(@CurrentUser() user: AuthUser, @Body() body: { provider: string; configurationVersionId: string; settlementId: string; date: string }) {
    return this.ingestion.ingest(this.clients.requireClientId(user), user.id, body);
  }
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
  @Get() list(@CurrentUser() user: AuthUser, @Query('page') page?: string) {
    return this.settlements.list(this.clients.requireClientId(user), page === undefined ? undefined : operationsPage(page));
  }
  @Post(':id/bank-confirmation') confirmBank(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { amount: string; currency: string; utr: string; creditedAt: string; accountLast4: string; evidenceReference: string }) {
    return this.settlements.confirmBank(this.clients.requireClientId(user), id, user.id, body);
  }
  @Post(':id/rematch') rematch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settlements.rematch(this.clients.requireClientId(user), id, user.id);
  }
  @Get(':id') detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.settlements.detail(this.clients.requireClientId(user), id);
  }
}
