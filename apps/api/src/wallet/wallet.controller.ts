import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { WalletService } from './wallet.service.js';
import { SecurityDepositService } from './security-deposit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletStatementService } from './wallet-statement.service.js';

@ApiTags('Rider wallet')
@ApiBearerAuth()
@Controller('rider-app/wallet')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderWalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly context: ClientContextService,
    private readonly deposits: SecurityDepositService,
    private readonly prisma: PrismaService,
    private readonly statements: WalletStatementService,
  ) {}
  private own(user: AuthUser) {
    return this.wallet.riderWallet(this.context.requireClientId(user), user.id);
  }
  @Get() async summary(@CurrentUser() user: AuthUser) {
    const wallet = await this.own(user);
    const { accounts: _accounts, ...balance } = await this.wallet.balance(
      wallet.clientId,
      wallet.id,
    );
    const [claims, lots] = await Promise.all([
      this.prisma.rewardClaim.findMany({
        where: { clientId: wallet.clientId, riderId: wallet.riderId },
        select: { creditedAmount: true },
      }),
      this.prisma.rewardLot.findMany({
        where: {
          clientId: wallet.clientId,
          riderId: wallet.riderId,
          status: 'AVAILABLE',
          expiresAt: {
            gt: new Date(),
            lte: new Date(Date.now() + 7 * 86400000),
          },
        },
        select: { remainingAmount: true },
      }),
    ]);
    const earned = claims.reduce(
      (sum, claim) => sum.plus(claim.creditedAmount),
      new Prisma.Decimal(0),
    );
    const expiring = lots.reduce(
      (sum, lot) => sum.plus(lot.remainingAmount),
      new Prisma.Decimal(0),
    );
    return {
      data: {
        id: wallet.id,
        status: wallet.status,
        ...balance,
        rewardsEarned: earned.toFixed(2),
        rewardsUsedOrExpired: Prisma.Decimal.max(
          earned.minus(balance.rewards.availableBalance),
          0,
        ).toFixed(2),
        rewardsExpiringWithinSevenDays: expiring.toFixed(2),
        securityDeposits: await this.deposits.forWallet(
          wallet.clientId,
          wallet.id,
        ),
        recentTransactions: await this.wallet.transactions(
          wallet.clientId,
          wallet.id,
          1,
          10,
        ),
      },
    };
  }
  @Get('balance') async balance(@CurrentUser() user: AuthUser) {
    const wallet = await this.own(user);
    const { accounts: _accounts, ...balance } = await this.wallet.balance(
      wallet.clientId,
      wallet.id,
    );
    return { data: balance };
  }
  @Get('withdrawal-eligibility') async withdrawalEligibility(
    @CurrentUser() user: AuthUser,
  ) {
    const wallet = await this.own(user);
    const balance = await this.wallet.balance(wallet.clientId, wallet.id);
    return {
      data: {
        eligible: false,
        cashAvailable: balance.cash.availableBalance,
        rewardRefundable: false,
        securityDepositReturnSeparate: true,
        reason: 'EXTERNAL_PAYOUT_RAIL_NOT_CONFIGURED',
      },
    };
  }
  @Get('statements') async statement(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const wallet = await this.own(user);
    return { data: await this.statements.statement(wallet.clientId, wallet.id, from, to, page, pageSize) };
  }
  @Get('receipts/payments/:id') async paymentReceipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const wallet = await this.own(user);
    const payment = await this.prisma.riderPayment.findFirst({ where: { id, clientId: wallet.clientId, riderId: wallet.riderId, status: 'CONFIRMED' }, select: { id: true, amount: true, currency: true, method: true, externalReference: true, receivedAt: true, allocations: { where: { reversedAt: null }, select: { amount: true, invoice: { select: { invoiceNumber: true } } } } } });
    if (!payment) throw new NotFoundException('RECEIPT_NOT_FOUND');
    return { data: { receiptNumber: `EVP-${payment.id}`, type: 'PAYMENT', amount: payment.amount.toFixed(2), currency: payment.currency, method: payment.method, reference: payment.externalReference, issuedAt: payment.receivedAt, invoices: payment.allocations.map(a => ({ number: a.invoice.invoiceNumber, amount: a.amount.toFixed(2) })) } };
  }
  @Get('receipts/refunds/:id') async refundReceipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const wallet = await this.own(user);
    const refund = await this.prisma.paymentRefund.findFirst({ where: { id, clientId: wallet.clientId, riderId: wallet.riderId, status: 'SUCCESS' }, select: { id: true, refundNumber: true, paymentId: true, amount: true, currency: true, providerReference: true, completedAt: true } });
    if (!refund) throw new NotFoundException('RECEIPT_NOT_FOUND');
    return { data: { receiptNumber: refund.refundNumber ?? `EVR-${refund.id}`, type: 'REFUND', paymentId: refund.paymentId, amount: refund.amount.toFixed(2), currency: refund.currency, reference: refund.providerReference, issuedAt: refund.completedAt } };
  }
  @Get('receipts/deposit-returns/:id') async depositReturnReceipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const wallet = await this.own(user);
    const returned = await this.prisma.walletDepositRefundRequest.findFirst({ where: { id, clientId: wallet.clientId, deposit: { riderId: wallet.riderId, walletId: wallet.id }, status: 'RETURNED' }, select: { id: true, depositId: true, amount: true, destinationType: true, externalReference: true, completedAt: true, deposit: { select: { currency: true } } } });
    if (!returned) throw new NotFoundException('RECEIPT_NOT_FOUND');
    return { data: { receiptNumber: `EVD-${returned.id}`, type: 'DEPOSIT_RETURN', depositId: returned.depositId, amount: returned.amount.toFixed(2), currency: returned.deposit.currency, destination: returned.destinationType, reference: returned.externalReference, issuedAt: returned.completedAt } };
  }
  @Get('transactions') async transactions(
    @CurrentUser() user: AuthUser,
    @Query('page') p?: string,
    @Query('pageSize') s?: string,
  ) {
    const wallet = await this.own(user);
    const page = Math.max(1, Number(p) || 1),
      pageSize = Math.min(100, Math.max(1, Number(s) || 20));
    return {
      data: await this.wallet.transactions(
        wallet.clientId,
        wallet.id,
        page,
        pageSize,
      ),
      meta: { page, pageSize },
    };
  }
  @Get('transactions/:id') async transaction(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.own(user);
    const transaction = await this.wallet.transaction(
      wallet.clientId,
      wallet.id,
      id,
    );
    if (!transaction) throw new BadRequestException('TRANSACTION_NOT_FOUND');
    return { data: transaction };
  }
}

@ApiTags('Wallet administration')
@ApiBearerAuth()
@Controller('wallets')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class WalletAdminController {
  constructor(
    private readonly wallet: WalletService,
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
  @Post('riders/:riderId/ensure') ensure(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
  ) {
    return this.wallet.ensure(this.client(user), riderId, user.id);
  }
  @Get(':walletId/balance') balance(
    @CurrentUser() user: AuthUser,
    @Param('walletId') walletId: string,
  ) {
    return this.wallet.balance(this.client(user), walletId);
  }
  @Post(':walletId/adjustments') adjustment(
    @CurrentUser() user: AuthUser,
    @Param('walletId') walletId: string,
    @Headers('idempotency-key') key: string,
    @Body()
    body: {
      direction: 'CREDIT' | 'DEBIT';
      amount: string;
      reason: string;
      bucket?: 'CASH' | 'REWARD';
    },
  ) {
    if (
      !['CREDIT', 'DEBIT'].includes(body?.direction) ||
      !['CASH', 'REWARD'].includes(body?.bucket ?? 'CASH') ||
      !body?.reason
    )
      throw new BadRequestException('INVALID_ADJUSTMENT');
    return this.wallet.adjust(
      this.client(user),
      walletId,
      user.id,
      body.direction,
      body.amount,
      body.reason,
      this.key(key),
      body.bucket ?? 'CASH',
    );
  }
  @Post(':walletId/holds') hold(
    @CurrentUser() user: AuthUser,
    @Param('walletId') walletId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { amount: string; reason: string },
  ) {
    if (!body?.reason) throw new BadRequestException('INVALID_HOLD');
    return this.wallet.hold(
      this.client(user),
      walletId,
      user.id,
      body.amount,
      body.reason,
      this.key(key),
    );
  }
  @Post('holds/:id/release') release(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wallet.transitionHold(
      this.client(user),
      id,
      user.id,
      'RELEASED',
    );
  }
  @Post('holds/:id/expire') expire(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wallet.transitionHold(
      this.client(user),
      id,
      user.id,
      'EXPIRED',
    );
  }
  @Post('holds/:id/capture') capture(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.wallet.transitionHold(
      this.client(user),
      id,
      user.id,
      'CAPTURED',
    );
  }
  @Post('transactions/:id/reverse') reverse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.wallet.reverse(this.client(user), id, user.id, this.key(key));
  }
  @Get(':walletId/transactions/:id/ledger') async ledger(
    @CurrentUser() user: AuthUser,
    @Param('walletId') walletId: string,
    @Param('id') id: string,
  ) {
    const transaction = await this.wallet.transaction(
      this.client(user),
      walletId,
      id,
    );
    if (!transaction) throw new BadRequestException('TRANSACTION_NOT_FOUND');
    return this.wallet.ledger(this.client(user), walletId, id);
  }
}
