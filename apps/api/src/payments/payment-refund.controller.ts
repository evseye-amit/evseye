import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { PaymentRefundService } from './payment-refund.service.js';

class RefundDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @Matches(/^[1-9]\d*(\.\d{1,2})?$/) amount?: string;
  @IsOptional() @IsIn(['UNALLOCATED_RETURN', 'PAYMENT_REVERSAL']) treatment?:
    'UNALLOCATED_RETURN' | 'PAYMENT_REVERSAL';
}
@Controller('client/riders/:riderId/payments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class PaymentRefundAdminController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly refunds: PaymentRefundService,
  ) {}
  @Post(':paymentId/refunds')
  async request(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Param('paymentId') paymentId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: RefundDto,
  ) {
    return {
      data: await this.refunds.request(
        this.clients.requireClientId(user),
        riderId,
        paymentId,
        user.id,
        key ?? '',
        dto.reason,
        dto.amount,
        dto.treatment,
      ),
    };
  }
  @Post('refunds/:refundId/verify')
  async verify(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Param('refundId') refundId: string,
  ) {
    return {
      data: await this.refunds.verify(
        this.clients.requireClientId(user),
        riderId,
        refundId,
      ),
    };
  }
  @Get('refunds')
  async list(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) {
    return {
      data: await this.refunds.list(
        this.clients.requireClientId(user),
        riderId,
      ),
    };
  }
}

@Controller('rider-app/payments/refunds')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderPaymentRefundController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly billing: RiderBillingService,
    private readonly refunds: PaymentRefundService,
  ) {}
  @Get() async list(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const riderId = await this.billing.riderForUser(clientId, user.id);
    const refunds = await this.refunds.list(clientId, riderId);
    return {
      data: refunds.map((refund) => ({
        id: refund.id,
        refundNumber: refund.refundNumber,
        paymentId: refund.paymentId,
        amount: refund.amount.toFixed(2),
        currency: refund.currency,
        status: refund.status,
        requestedAt: refund.requestedAt,
        completedAt: refund.completedAt,
      })),
    };
  }
}

@Controller('webhooks/payments/cashfree')
export class CashfreeRefundWebhookController {
  constructor(private readonly refunds: PaymentRefundService) {}
  @Post('refund')
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is required.');
    return this.refunds.webhook(
      request.rawBody,
      timestamp ?? '',
      signature ?? '',
      'CHECKOUT',
    );
  }
  @Post('subscription-refund')
  @HttpCode(200)
  receiveSubscription(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is required.');
    return this.refunds.webhook(
      request.rawBody,
      timestamp ?? '',
      signature ?? '',
      'SUBSCRIPTION',
    );
  }
}
