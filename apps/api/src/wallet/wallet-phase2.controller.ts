import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ClientContextService } from '../auth/client-context.service.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { WalletService, money } from './wallet.service.js';
import { SecurityDepositService } from './security-deposit.service.js';
import {
  WalletPolicyService,
  chargeCategories,
  planFunding,
  type ChargeCategory,
  type PolicyRules,
} from './wallet-policy.service.js';

@ApiTags('Rider wallet')
@ApiBearerAuth()
@Controller('rider-app/wallet/security-deposits')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderWalletDepositController {
  constructor(
    private readonly wallet: WalletService,
    private readonly deposits: SecurityDepositService,
    private readonly context: ClientContextService,
  ) {}
  @Get() async list(@CurrentUser() user: AuthUser) {
    const wallet = await this.wallet.riderWallet(
      this.context.requireClientId(user),
      user.id,
    );
    return { data: await this.deposits.forWallet(wallet.clientId, wallet.id) };
  }
  @Get(':id') async detail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.wallet.riderWallet(
      this.context.requireClientId(user),
      user.id,
    );
    const summary = await this.deposits.summary(wallet.clientId, id);
    if (summary.walletId !== wallet.id)
      throw new BadRequestException('SECURITY_DEPOSIT_NOT_FOUND');
    return { data: summary };
  }
}

@ApiTags('Wallet administration')
@ApiBearerAuth()
@Controller('wallets')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class WalletPhase2AdminController {
  constructor(
    private readonly wallet: WalletService,
    private readonly deposits: SecurityDepositService,
    private readonly policies: WalletPolicyService,
    private readonly context: ClientContextService,
  ) {}
  private client(user: AuthUser) {
    return this.context.requireClientId(user);
  }
  private key(key?: string) {
    if (!key || key.length > 160)
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    return key;
  }
  @Get('policy/current') policy(@CurrentUser() user: AuthUser) {
    return this.policies.effective(this.client(user));
  }
  @Put('policy') updatePolicy(
    @CurrentUser() user: AuthUser,
    @Body() body: Partial<PolicyRules>,
  ) {
    return this.policies.update(this.client(user), user.id, body);
  }
  @Post('riders/:riderId/security-deposits') requirement(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Body() body: { amount: string; sourceType: string; sourceId: string },
  ) {
    return this.deposits.requirement(this.client(user), riderId, user.id, body);
  }
  @Get('security-deposits/:id') deposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.summary(this.client(user), id);
  }
  @Post('security-deposits/:id/funding') fund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { amount: string },
  ) {
    return this.deposits.fund(
      this.client(user),
      id,
      user.id,
      body.amount,
      this.key(key),
    );
  }
  @Post('security-deposits/:id/lock') lock(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.lock(this.client(user), id, user.id);
  }
  @Post('security-deposits/:id/holds') hold(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { amount: string; reason: string; expiresAt?: string },
  ) {
    if (!body.reason) throw new BadRequestException('INVALID_HOLD');
    return this.deposits.hold(
      this.client(user),
      id,
      user.id,
      body.amount,
      body.reason,
      this.key(key),
      body.expiresAt,
    );
  }
  @Post('security-deposits/:id/holds/:holdId/release') release(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('holdId') holdId: string,
  ) {
    return this.deposits.releaseHold(this.client(user), id, holdId, user.id);
  }
  @Post('security-deposits/:id/holds/:holdId/expire') expire(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('holdId') holdId: string,
  ) {
    return this.deposits.expireHold(this.client(user), id, holdId, user.id);
  }
  @Post('security-deposits/:id/deductions') deduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      amount: string;
      reasonCode: string;
      description: string;
      referenceType: string;
      referenceId: string;
      holdId?: string;
    },
  ) {
    return this.deposits.deduct(
      this.client(user),
      id,
      user.id,
      body,
      this.key(key),
    );
  }
  @Post('security-deposits/:id/forfeitures') forfeit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      amount: string;
      reasonCode: string;
      description: string;
      referenceType: string;
      referenceId: string;
    },
  ) {
    return this.deposits.forfeit(
      this.client(user),
      id,
      user.id,
      body,
      this.key(key),
    );
  }
  @Get('security-deposits/:id/refund-eligibility') eligibility(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.deposits.eligibility(this.client(user), id);
  }
  @Post('security-deposits/:id/refund-requests') requestRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      amount: string;
      reason: string;
      destinationType?: 'WALLET_CASH' | 'MANUAL_OFFLINE';
    },
  ) {
    if (
      body.destinationType &&
      !['WALLET_CASH', 'MANUAL_OFFLINE'].includes(body.destinationType)
    )
      throw new BadRequestException('INVALID_RETURN_DESTINATION');
    return this.deposits.requestRefund(
      this.client(user),
      id,
      user.id,
      body.amount,
      body.reason,
      this.key(key),
      body.destinationType,
    );
  }
  @Post('security-deposits/:id/refund-requests/:requestId/approve')
  approveRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.deposits.approveRefund(
      this.client(user),
      id,
      requestId,
      user.id,
    );
  }
  @Post('security-deposits/:id/refund-requests/:requestId/complete-manual')
  completeManualReturn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() body: { externalReference: string },
  ) {
    return this.deposits.completeManualReturn(
      this.client(user),
      id,
      requestId,
      user.id,
      body.externalReference,
    );
  }
  @Post(':walletId/funding-plan') async fundingPlan(
    @CurrentUser() user: AuthUser,
    @Param('walletId') walletId: string,
    @Body() body: { amount: string; category: ChargeCategory },
  ) {
    const clientId = this.client(user);
    if (!chargeCategories.includes(body.category))
      throw new BadRequestException('INVALID_CHARGE_CATEGORY');
    const balance = await this.wallet.balance(clientId, walletId),
      policy = await this.policies.effective(clientId);
    return planFunding(
      money(body.amount),
      body.category,
      {
        cash: Prisma.Decimal.max(
          new Prisma.Decimal(balance.cash.availableBalance),
          0,
        ),
        reward: Prisma.Decimal.max(
          new Prisma.Decimal(balance.rewards.availableBalance),
          0,
        ),
      },
      policy,
    );
  }
}
