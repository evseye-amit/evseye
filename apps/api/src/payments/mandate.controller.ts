import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { MandateService } from './mandate.service.js';

@ApiTags('Rider AutoPay')
@Controller('rider-app/payments/autopay')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderMandateController {
  constructor(
    private readonly mandates: MandateService,
    private readonly clients: ClientContextService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get active package AutoPay configuration and current mandate',
  })
  async current(@CurrentUser() user: AuthUser) {
    return {
      data: await this.mandates.current(
        this.clients.requireClientId(user),
        user.id,
      ),
    };
  }

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Stable unique key for this authorization attempt; reuse on retry.',
  })
  @ApiOperation({
    summary:
      'Create a UPI AutoPay mandate and return its Cashfree checkout session',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key?: string,
  ) {
    return {
      data: await this.mandates.create(
        this.clients.requireClientId(user),
        user.id,
        key ?? '',
      ),
    };
  }

  @Post(':mandateId/verify')
  @ApiOperation({
    summary:
      'Fetch Cashfree subscription status after authorization; only verified ACTIVE enables AutoPay',
  })
  async verify(
    @CurrentUser() user: AuthUser,
    @Param('mandateId') mandateId: string,
  ) {
    return {
      data: await this.mandates.verify(
        this.clients.requireClientId(user),
        user.id,
        mandateId,
      ),
    };
  }
}

@ApiTags('Payment Webhooks')
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly mandates: MandateService) {}

  @Post('cashfree')
  @HttpCode(200)
  @ApiHeader({ name: 'x-webhook-signature', required: true })
  @ApiHeader({ name: 'x-webhook-timestamp', required: true })
  async cashfree(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is required.');
    return this.mandates.webhook(
      request.rawBody,
      timestamp ?? '',
      signature ?? '',
    );
  }
}
