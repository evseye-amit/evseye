import { BadRequestException, Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { MandateService } from './mandate.service.js';

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
