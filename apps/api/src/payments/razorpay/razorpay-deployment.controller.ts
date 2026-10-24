import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../../auth/client-context.service.js';
import { RazorpayDeploymentService } from './razorpay-deployment.service.js';

@Controller('webhooks/payments')
export class RazorpayWebhookController {
  constructor(private readonly service: RazorpayDeploymentService) {}
  @Post('razorpay')
  @HttpCode(200)
  @ApiHeader({ name: 'x-razorpay-signature', required: true })
  @ApiHeader({ name: 'x-razorpay-event-id', required: true })
  webhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-razorpay-signature') signature = '',
    @Headers('x-razorpay-event-id') eventId = '',
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is required.');
    return this.service.webhook(request.rawBody, signature, eventId);
  }
}
@Controller('client/payments/razorpay/deployments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class RazorpayDeploymentAdminController {
  constructor(
    private readonly service: RazorpayDeploymentService,
    private readonly clients: ClientContextService,
  ) {}
  @Get(':allocationId')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('allocationId') id: string,
  ) {
    return {
      data: await this.service.details(this.clients.requireClientId(user), id),
    };
  }
  @Post(':allocationId/reconcile')
  @HttpCode(200)
  async reconcile(
    @CurrentUser() user: AuthUser,
    @Param('allocationId') id: string,
  ) {
    return {
      data: await this.service.reconcileAllocation(
        this.clients.requireClientId(user),
        id,
      ),
    };
  }
}
