import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsIn } from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PaymentReconciliationService } from './payment-reconciliation.service.js';
class RetryDto {
  @IsIn(['CHECKOUT', 'AUTOPAY']) source!: 'CHECKOUT' | 'AUTOPAY';
}
@Controller('client/payment-reconciliation')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class PaymentReconciliationController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly reconciliation: PaymentReconciliationService,
  ) {}
  @Get() async report(
    @CurrentUser() user: AuthUser,
    @Query('riderId') riderId?: string,
  ) {
    return {
      data: await this.reconciliation.report(
        this.clients.requireClientId(user),
        riderId,
      ),
    };
  }
  @Post(':riderId/:id/retry') async retry(
    @CurrentUser() user: AuthUser,
    @Param('riderId') riderId: string,
    @Param('id') id: string,
    @Body() dto: RetryDto,
  ) {
    return {
      data: await this.reconciliation.retry(
        this.clients.requireClientId(user),
        riderId,
        dto.source,
        id,
      ),
    };
  }
}

@Controller('platform/payment-reconciliation')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformPaymentReconciliationController {
  constructor(private readonly reconciliation: PaymentReconciliationService) {}
  @Get('unknown-provider-events')
  async unknownProviderEvents() {
    return { data: await this.reconciliation.unknownProviderEvents() };
  }
}
