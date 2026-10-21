import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderWalletTransactionsQueryDto } from './dto/rider-wallet.dto.js';
import { RiderWalletOperationsService } from './rider-wallet.service.js';

@Controller('riders/:riderId/wallet')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderWalletOperationsController {
  constructor(private readonly wallet: RiderWalletOperationsService, private readonly clients: ClientContextService) {}
  @Get()
  async balance(@CurrentUser() user: AuthUser, @Param('riderId', ParseUUIDPipe) riderId: string) {
    return { data: await this.wallet.balance(this.clients.requireClientId(user), riderId) };
  }
  @Get('transactions')
  async transactions(@CurrentUser() user: AuthUser, @Param('riderId', ParseUUIDPipe) riderId: string, @Query() query: RiderWalletTransactionsQueryDto) {
    return { data: await this.wallet.transactions(this.clients.requireClientId(user), riderId, query) };
  }
}
