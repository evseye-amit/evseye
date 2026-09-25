import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsISO8601 } from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { RiderBillingService } from '../rider-billing/rider-billing.service.js';
import { PaymentOrchestratorService } from './payment-orchestrator.service.js';

export class ScheduleInvoiceCollectionDto {
  @ApiProperty({
    description:
      'Future ISO-8601 time for the Cashfree subscription charge. Cashfree handles its pre-debit notification process.',
  })
  @IsISO8601()
  scheduledAt!: string;
}

@ApiTags('Rider Billing Collections')
@Controller('client/riders/:riderId/billing/invoices/:invoiceId/collect')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class InvoiceCollectionController {
  constructor(
    private readonly collections: PaymentOrchestratorService,
    private readonly clients: ClientContextService,
  ) {}

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Reuse for retries of the same invoice collection.',
  })
  @ApiOperation({
    summary:
      'Schedule the finalized invoice outstanding amount against an active Rider AutoPay mandate',
  })
  async collect(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Param('invoiceId') invoiceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: ScheduleInvoiceCollectionDto,
  ) {
    if (!key) throw new BadRequestException('Idempotency-Key is required.');
    return {
      data: await this.collections.collect(
        this.clients.requireClientId(user),
        riderId,
        invoiceId,
        key,
        dto.scheduledAt,
      ),
    };
  }
}

@ApiTags('Rider Payments')
@Controller('rider-app/billing/payments')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderPaymentCollectionController {
  constructor(
    private readonly collections: PaymentOrchestratorService,
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

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const { clientId, riderId } = await this.context(user);
    return { data: await this.collections.list(clientId, riderId) };
  }

  @Post(':paymentId/verify')
  @ApiOperation({
    summary:
      'Reconcile this Rider payment with Cashfree; only verified success settles its invoice',
  })
  async verify(
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
  ) {
    const { clientId, riderId } = await this.context(user);
    return {
      data: await this.collections.verify(clientId, riderId, paymentId),
    };
  }
}
