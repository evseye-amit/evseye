import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletBillingService } from './wallet-billing.service.js';

const key = (value?: string) => { if (!value || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED'); return value; };
@ApiTags('Wallet billing')
@ApiBearerAuth()
@Controller('wallets/billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class WalletBillingController {
  constructor(private readonly billing: WalletBillingService, private readonly prisma: PrismaService, private readonly clients: ClientContextService) {}
  private client(user: AuthUser) { return this.clients.requireClientId(user); }
  @Post('agreements/:agreementId/one-time-invoices') async generate(@CurrentUser() user: AuthUser, @Param('agreementId') agreementId: string) { return { data: await this.billing.generateOneTime(this.client(user), agreementId, user.id) }; }
  @Post('invoices/:invoiceId/settle') @ApiHeader({ name: 'Idempotency-Key', required: true }) async settle(@CurrentUser() user: AuthUser, @Param('invoiceId') id: string, @Headers('idempotency-key') header?: string) { return { data: await this.billing.settle(this.client(user), id, user.id, key(header)) }; }
  @Post('invoices/:invoiceId/void') async voidInvoice(@CurrentUser() user: AuthUser, @Param('invoiceId') id: string, @Body() body: { reason: string }) { return { data: await this.billing.voidUnpaidOneTime(this.client(user), id, user.id, body.reason) }; }
  @Post('settlements/:transactionId/reverse') @ApiHeader({ name: 'Idempotency-Key', required: true }) async reverse(@CurrentUser() user: AuthUser, @Param('transactionId') id: string, @Headers('idempotency-key') header?: string) { return { data: await this.billing.reverse(this.client(user), id, user.id, key(header)) }; }
  @Get('invoices/:invoiceId/allocations') allocations(@CurrentUser() user: AuthUser, @Param('invoiceId') id: string) { return this.prisma.walletInvoiceAllocation.findMany({ where: { clientId: this.client(user), invoiceId: id }, orderBy: { createdAt: 'asc' } }); }
}
