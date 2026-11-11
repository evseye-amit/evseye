import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AutoCollectionService } from './auto-collection.service.js';
class PolicyDto {
  @IsBoolean() enabled!: boolean;
  @IsIn(['ON_INVOICE_ISSUE', 'ON_DUE_DATE', 'BEFORE_DUE_DATE', 'CUSTOM'])
  collectionTiming!: string;
  @IsInt() @Min(0) @Max(30) beforeDueDays!: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) collectionHourIst?: number;
  @IsOptional() @IsInt() @Min(0) @Max(59) collectionMinuteIst?: number;
  @IsBoolean() retryEnabled!: boolean;
  @IsInt() @Min(1) @Max(10) maximumAttempts!: number;
  @IsArray() @IsInt({ each: true }) retryIntervalsDays!: number[];
  @IsArray() @IsString({ each: true }) autoCollectCategories!: string[];
  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  maximumAutoDebit?: string;
  @IsOptional() @IsBoolean() walletFirst?: boolean;
}
@Controller('client/payment-collection-policy')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN)
export class PaymentCollectionPolicyController {
  constructor(
    private readonly clients: ClientContextService,
    private readonly prisma: PrismaService,
    private readonly auto: AutoCollectionService,
  ) {}
  @Get() async get(@CurrentUser() user: AuthUser) {
    return {
      data: await this.prisma.paymentCollectionPolicy.findUnique({
        where: { clientId: this.clients.requireClientId(user) },
      }),
    };
  }
  @Put() async put(@CurrentUser() user: AuthUser, @Body() dto: PolicyDto) {
    return {
      data: await this.auto.setPolicy(
        this.clients.requireClientId(user),
        user.id,
        dto,
      ),
    };
  }
}
