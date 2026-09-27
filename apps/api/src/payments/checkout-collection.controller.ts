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
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { CheckoutCollectionService } from './checkout-collection.service.js';

@ApiTags('Rider Checkout')
@Controller('rider-app/billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderCheckoutController {
  constructor(
    private readonly checkout: CheckoutCollectionService,
    private readonly billing: RiderBillingService,
    private readonly clients: ClientContextService,
  ) {}
  private async context(user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    return {
      clientId,
      riderId: await this.billing.riderForUser(clientId, user.id),
    };
  }
  @Post('invoices/:invoiceId/pay')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Headers('idempotency-key') key?: string,
    @Body() body?: { useWallet?: boolean },
  ) {
    if (body?.useWallet !== undefined && typeof body.useWallet !== 'boolean')
      throw new BadRequestException('useWallet must be a boolean.');
    const { clientId, riderId } = await this.context(user);
    return {
      data: await this.checkout.payInvoice(
        clientId,
        riderId,
        invoiceId,
        key ?? '',
        body?.useWallet ?? true,
        user.id,
      ),
    };
  }
  @Post('payments/pay-outstanding')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async payOutstanding(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key?: string,
  ) {
    const { clientId, riderId } = await this.context(user);
    return {
      data: await this.checkout.payOutstanding(clientId, riderId, key ?? ''),
    };
  }
  @Post('deposits/:depositId/pay')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async payDeposit(
    @CurrentUser() user: AuthUser,
    @Param('depositId') depositId: string,
    @Headers('idempotency-key') key?: string,
  ) {
    const { clientId, riderId } = await this.context(user);
    return {
      data: await this.checkout.payDeposit(
        clientId,
        riderId,
        depositId,
        key ?? '',
      ),
    };
  }
  @Post('collections/:collectionId/verify')
  async verify(
    @CurrentUser() user: AuthUser,
    @Param('collectionId') collectionId: string,
  ) {
    const { clientId, riderId } = await this.context(user);
    return {
      data: await this.checkout.verify(clientId, riderId, collectionId),
    };
  }
  @Get('collections')
  async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.context(user);
    return { data: await this.checkout.list(clientId, riderId) };
  }
  @Get('collections/:collectionId')
  async detail(@CurrentUser() user: AuthUser, @Param('collectionId') collectionId: string) {
    const { clientId, riderId } = await this.context(user);
    return { data: await this.checkout.detail(clientId, riderId, collectionId) };
  }
}

@ApiTags('Payment Webhooks')
@Controller('webhooks/payments/cashfree')
export class CheckoutWebhookController {
  constructor(private readonly checkout: CheckoutCollectionService) {}
  @Post('checkout')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is required.');
    return this.checkout.webhook(
      request.rawBody,
      timestamp ?? '',
      signature ?? '',
    );
  }
}
