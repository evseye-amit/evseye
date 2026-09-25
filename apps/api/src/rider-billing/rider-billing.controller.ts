import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiHeader } from '@nestjs/swagger';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CreateRiderChargeDto, CreateRiderCreditDto, FinalizeRiderInvoiceDto } from './dto/billing.dto.js';
import { RiderBillingService } from './rider-billing.service.js';

function idempotencyKey(value?: string) {
  if (!value || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) throw new BadRequestException('An Idempotency-Key header of 8–120 letters, digits, colon, underscore, or hyphen is required.');
  return value;
}

@Controller('client/riders/:riderId/billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderBillingOperationsController {
  constructor(private readonly billing: RiderBillingService, private readonly clients: ClientContextService) {}

  @Get() async overview(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.billing.overview(this.clients.requireClientId(user), riderId) }; }
  @Get('invoices') async invoices(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.billing.invoices(this.clients.requireClientId(user), riderId) }; }
  @Get('invoices/:invoiceId') async invoice(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Param('invoiceId') invoiceId: string) { return { data: await this.billing.invoice(this.clients.requireClientId(user), riderId, invoiceId) }; }
  @Get('ledger') async ledger(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.billing.ledger(this.clients.requireClientId(user), riderId) }; }
  @Post('charges') @Roles(UserRole.CLIENT_ADMIN) @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable unique key for this financial charge.' })
  async charge(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateRiderChargeDto) { return { data: await this.billing.postCharge(this.clients.requireClientId(user), riderId, user.id, idempotencyKey(key), dto) }; }
  @Post('credits') @Roles(UserRole.CLIENT_ADMIN) @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable unique key for this financial credit.' })
  async credit(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateRiderCreditDto) { return { data: await this.billing.postCredit(this.clients.requireClientId(user), riderId, user.id, idempotencyKey(key), dto) }; }
  @Post('invoices/finalize') @Roles(UserRole.CLIENT_ADMIN)
  async finalize(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Body() dto: FinalizeRiderInvoiceDto) { return { data: await this.billing.finalizeInvoice(this.clients.requireClientId(user), riderId, user.id, dto) }; }
}

@Controller('rider-app/billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderBillingAppController {
  constructor(private readonly billing: RiderBillingService, private readonly clients: ClientContextService) {}
  private async context(user: AuthUser) { const clientId = this.clients.requireClientId(user); return { clientId, riderId: await this.billing.riderForUser(clientId, user.id) }; }
  @Get() async overview(@CurrentUser() user: AuthUser) { const { clientId, riderId } = await this.context(user); return { data: await this.billing.overview(clientId, riderId) }; }
  @Get('invoices') async invoices(@CurrentUser() user: AuthUser) { const { clientId, riderId } = await this.context(user); return { data: await this.billing.invoices(clientId, riderId) }; }
  @Get('invoices/:invoiceId') async invoice(@CurrentUser() user: AuthUser, @Param('invoiceId') invoiceId: string) { const { clientId, riderId } = await this.context(user); return { data: await this.billing.invoice(clientId, riderId, invoiceId) }; }
  @Get('ledger') async ledger(@CurrentUser() user: AuthUser) { const { clientId, riderId } = await this.context(user); return { data: await this.billing.ledger(clientId, riderId) }; }
}
