import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { CommercialOfferService } from '../rider-rate-cards/commercial-offer.service.js';
import { RiderDepositService } from './deposit.service.js';

@Controller('rider-deposits')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderDepositsController {
  constructor(
    private readonly deposits: RiderDepositService,
    private readonly context: ClientContextService,
  ) {}
  private client(user: AuthUser) {
    return this.context.requireClientId(user);
  }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deposits.get(this.client(user), id);
  }
  @Get(':id/transactions') transactions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.transactions(this.client(user), id);
  }
  @Get(':id/reconcile') @Roles(UserRole.CLIENT_ADMIN) reconcile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.reconcile(this.client(user), id);
  }
  @Post(':id/collections') collect(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.move(
      this.client(user),
      user.id,
      id,
      body,
      key,
      'COLLECTION',
    );
  }
  @Post(':id/deductions') @Roles(UserRole.CLIENT_ADMIN) deduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.move(
      this.client(user),
      user.id,
      id,
      body,
      key,
      'DEDUCTION',
    );
  }
  @Post(':id/forfeitures') @Roles(UserRole.CLIENT_ADMIN) forfeit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.move(
      this.client(user),
      user.id,
      id,
      body,
      key,
      'FORFEITURE',
    );
  }
  @Post(':id/adjustment-credits') @Roles(UserRole.CLIENT_ADMIN) credit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.move(
      this.client(user),
      user.id,
      id,
      body,
      key,
      'ADJUSTMENT_CREDIT',
    );
  }
  @Post(':id/adjustment-debits') @Roles(UserRole.CLIENT_ADMIN) debit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.move(
      this.client(user),
      user.id,
      id,
      body,
      key,
      'ADJUSTMENT_DEBIT',
    );
  }
  @Post(':id/refund-requests') @Roles(UserRole.CLIENT_ADMIN) refundRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.requestRefund(
      this.client(user),
      user.id,
      id,
      body,
      key,
    );
  }
  @Post(':id/close') @Roles(UserRole.CLIENT_ADMIN) close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.deposits.close(this.client(user), user.id, id, body);
  }
  @Post('refund-requests/:id/complete')
  @Roles(UserRole.CLIENT_ADMIN)
  completeRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { externalReference: string },
  ) {
    return this.deposits.completeRefund(
      this.client(user),
      user.id,
      id,
      body.externalReference,
    );
  }
  @Post('transfers') @Roles(UserRole.CLIENT_ADMIN) transfer(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.transfer(this.client(user), user.id, body, key);
  }
  @Post('transactions/:id/reverse') @Roles(UserRole.CLIENT_ADMIN) reverse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.deposits.reverse(this.client(user), user.id, id, body, key);
  }
}

@Controller('rider-deposit-policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class RiderDepositPolicyController {
  constructor(
    private readonly deposits: RiderDepositService,
    private readonly context: ClientContextService,
  ) {}
  @Post() set(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.deposits.setActivationPolicy(
      this.context.requireClientId(user),
      user.id,
      body,
    );
  }
}

@Controller('rider-rental-agreements')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class AgreementDepositsController {
  constructor(
    private readonly deposits: RiderDepositService,
    private readonly context: ClientContextService,
  ) {}
  @Post(':id/deposits/initialize') initialize(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.initializeAgreement(
      this.context.requireClientId(user),
      user.id,
      id,
    );
  }
  @Get(':id/deposits') list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.agreementSummary(
      this.context.requireClientId(user),
      id,
    );
  }
  @Get(':id/deposit-readiness') readiness(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.readiness(this.context.requireClientId(user), id);
  }
  @Get(':id/deposit-settlement') settlement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.settlement(this.context.requireClientId(user), id);
  }
}

@Controller('riders')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderDepositAdminQueriesController {
  constructor(
    private readonly deposits: RiderDepositService,
    private readonly context: ClientContextService,
  ) {}
  @Get(':id/deposits') list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.listForRider(this.context.requireClientId(user), id);
  }
  @Get(':id/commercial-summary') summary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.riderCommercialSummary(
      this.context.requireClientId(user),
      id,
    );
  }
}

@Controller('rider-app/deposits')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderDepositsAppController {
  constructor(
    private readonly deposits: RiderDepositService,
    private readonly pricing: CommercialOfferService,
    private readonly context: ClientContextService,
  ) {}
  private async identity(user: AuthUser) {
    const clientId = this.context.requireClientId(user);
    return {
      clientId,
      riderId: await this.pricing.riderIdForUser(clientId, user.id),
    };
  }
  @Get() async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.identity(user);
    const rows = await this.deposits.listForRider(clientId, riderId);
    return rows.map((row) => ({
      id: row.id,
      depositType: row.depositType,
      agreementId: row.agreementId,
      vehicleId: row.vehicleId,
      currency: row.currency,
      status: row.status,
      balances: depositBalancesView(row),
    }));
  }
  @Get(':id/transactions') async transactions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const { clientId, riderId } = await this.identity(user);
    const rows = await this.deposits.transactions(clientId, id, riderId);
    return rows.map((row) => ({
      id: row.id,
      type: row.transactionType,
      amount: row.amount.toFixed(2),
      occurredAt: row.createdAt,
      reason: row.reason,
    }));
  }
  @Get('commercial-summary') async summary(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.identity(user);
    return this.deposits.riderCommercialSummary(clientId, riderId);
  }
}

function depositBalancesView(row: {
  requiredAmount: { toFixed(digits: number): string };
  fundedAmount: { toFixed(digits: number): string };
  availableAmount: { toFixed(digits: number): string };
}) {
  return {
    required: row.requiredAmount.toFixed(2),
    paid: row.fundedAmount.toFixed(2),
    available: row.availableAmount.toFixed(2),
  };
}
