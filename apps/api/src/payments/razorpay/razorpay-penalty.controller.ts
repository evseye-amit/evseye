import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface.js';
import { ClientContextService } from '../../auth/client-context.service.js';
import { IsOptional, IsString, Matches } from 'class-validator';
import { RazorpayPenaltyService } from './razorpay-penalty.service.js';

export class RazorpayPenaltyOrderDto {
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/)
  amount?: string;
}
export class RazorpayPenaltyVerifyDto {
  @IsString() @Matches(/^order_[A-Za-z0-9]+$/) razorpayOrderId!: string;
  @IsString() @Matches(/^pay_[A-Za-z0-9]+$/) razorpayPaymentId!: string;
  @IsString() @Matches(/^[a-fA-F0-9]{64}$/) razorpaySignature!: string;
}
@Controller('rider-app/submission-penalties/razorpay')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RazorpayPenaltyController {
  constructor(
    private readonly service: RazorpayPenaltyService,
    private readonly clients: ClientContextService,
  ) {}
  @Post('order')
  @HttpCode(200)
  async order(
    @CurrentUser() user: AuthUser,
    @Body() body: RazorpayPenaltyOrderDto,
  ) {
    return {
      data: await this.service.createOrder(
        this.clients.requireClientId(user),
        user.id,
        body,
      ),
    };
  }
  @Post('verify')
  @HttpCode(200)
  async verify(
    @CurrentUser() user: AuthUser,
    @Body() body: RazorpayPenaltyVerifyDto,
  ) {
    return {
      data: await this.service.verify(
        this.clients.requireClientId(user),
        user.id,
        body,
      ),
    };
  }
}
