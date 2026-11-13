import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../auth/client-context.service.js';
import { CommonPaymentService } from './common-payment.service.js';

@ApiTags('Rider Payments')
@Controller('rider-app/payments/orders')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class CommonPaymentController {
  constructor(
    private readonly payments: CommonPaymentService,
    private readonly clients: ClientContextService,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create or reuse checkout for a server-validated payment purpose',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Required for INVOICE payments (including Razorpay), configured-provider checkout and Cashfree penalties; reuse for retries.',
  })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'allocationId'],
          properties: {
            purpose: { type: 'string', enum: ['DEPLOYMENT'] },
            allocationId: { type: 'string', format: 'uuid' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['purpose'],
          properties: {
            purpose: { type: 'string', enum: ['SUBMISSION_PENALTY'] },
            provider: {
              type: 'string',
              enum: ['RAZORPAY', 'CASHFREE'],
              default: 'RAZORPAY',
            },
            amount: { type: 'string', example: '500.00' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['purpose'],
          properties: {
            purpose: { type: 'string', enum: ['OUTSTANDING'] },
            amount: { type: 'string', example: '500.00' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'invoiceId'],
          properties: {
            purpose: { type: 'string', enum: ['INVOICE'] },
            provider: {
              type: 'string',
              enum: ['RAZORPAY', 'CASHFREE'],
              description:
                'RAZORPAY supports rental invoices. Omit to retain the configured checkout provider.',
            },
            invoiceId: { type: 'string', format: 'uuid' },
            useWallet: { type: 'boolean' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['purpose', 'depositId'],
          properties: {
            purpose: { type: 'string', enum: ['SECURITY_DEPOSIT'] },
            depositId: { type: 'string', format: 'uuid' },
          },
        },
      ],
    },
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return {
      data: await this.payments.create(
        this.clients.requireClientId(user),
        user.id,
        body,
        key,
      ),
    };
  }
  @Get(':paymentRequestId')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('paymentRequestId') id: string,
  ) {
    return {
      data: await this.payments.detail(
        this.clients.requireClientId(user),
        user.id,
        id,
      ),
    };
  }
  @Post(':paymentRequestId/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verify with the provider and purpose stored against the payment request',
  })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        razorpayOrderId: { type: 'string' },
        razorpayPaymentId: { type: 'string' },
        razorpaySignature: { type: 'string' },
      },
    },
  })
  async verify(
    @CurrentUser() user: AuthUser,
    @Param('paymentRequestId') id: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.payments.verify(
        this.clients.requireClientId(user),
        user.id,
        id,
        body,
      ),
    };
  }
}
