import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { UserRole, Prisma } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ClientContextService } from '../auth/client-context.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthUser } from '../auth/interfaces/auth-user.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RiderBillingEngineService } from './rider-billing-engine.service.js';
import { RiderPaymentsService } from './rider-payments.service.js';
import { RiderBillingService } from './rider-billing.service.js';

const key = (value?: string) => {
  if (!value || !/^[A-Za-z0-9:_-]{8,120}$/.test(value)) throw new BadRequestException('Idempotency-Key is required.');
  return value;
};
class ScheduleDto {
  @IsString() agreementId!: string;
  @IsIn(['DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM']) frequency!: string;
  @IsOptional() @IsInt() @Min(1) @Max(366) customDays?: number;
  @IsIn(['PREPAID', 'POSTPAID']) billingMode!: string;
  @IsIn(['AGREEMENT_START', 'VEHICLE_HANDOVER', 'FIXED_WEEKDAY', 'CALENDAR_MONTH', 'CUSTOM_DATE']) anchorType!: string;
  @IsISO8601() anchorAt!: string;
  @IsString() @MaxLength(80) timezone!: string;
}
class PaymentDto {
  @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'NET_BANKING', 'MANDATE', 'WALLET', 'OTHER']) method!: string;
  @IsOptional() @IsString() @MaxLength(160) externalReference?: string;
  @IsOptional() @IsISO8601() receivedAt?: string;
}
class AllocationDto {
  @IsIn(['OLDEST_DUE_FIRST', 'OLDEST_INVOICE_FIRST', 'SPECIFIC_INVOICE', 'MANUAL']) policy!: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,2})?$/) amount?: string;
}
class ReverseDto { @IsString() @MaxLength(500) reason!: string; }
class BillingPolicyDto {
  @IsIn(['PREPAID', 'POSTPAID']) billingMode!: string;
  @IsInt() @Min(0) @Max(365) paymentTermsDays!: number;
  @IsInt() @Min(0) @Max(365) gracePeriodDays!: number;
  @IsOptional() @IsBoolean() autoSettleInvoiceFromWallet?: boolean;
}
class TaxProfileDto {
  @IsString() @MaxLength(80) supplierState!: string;
  @IsOptional() @IsString() @MaxLength(20) supplierGstin?: string;
  @IsString() @MaxLength(80) placeOfSupply!: string;
  @IsOptional() @IsString() @MaxLength(20) customerGstin?: string;
}
class TaxRuleDto {
  @IsString() @MaxLength(60) taxCode!: string;
  @IsString() @MaxLength(60) chargeType!: string;
  @IsString() @Matches(/^\d+(?:\.\d{1,4})?$/) cgstRate!: string;
  @IsString() @Matches(/^\d+(?:\.\d{1,4})?$/) sgstRate!: string;
  @IsString() @Matches(/^\d+(?:\.\d{1,4})?$/) igstRate!: string;
  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;
}

@Controller('client/riders/:riderId/billing')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.CLIENT_ADMIN, UserRole.OPERATIONS_MANAGER)
export class RiderBillingPhase6Controller {
  constructor(private readonly clients: ClientContextService, private readonly prisma: PrismaService, private readonly engine: RiderBillingEngineService, private readonly payments: RiderPaymentsService, private readonly billing: RiderBillingService) {}
  @Get('reconciliation') async reconciliation(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.billing.reconcile(this.clients.requireClientId(user), riderId) }; }
  @Get('schedules') async schedules(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.prisma.riderBillingSchedule.findMany({ where: { clientId: this.clients.requireClientId(user), riderId }, orderBy: { createdAt: 'desc' } }) }; }
  @Post('schedules') @Roles(UserRole.CLIENT_ADMIN)
  async schedule(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Body() dto: ScheduleDto) { return { data: await this.engine.createSchedule(this.clients.requireClientId(user), riderId, user.id, dto) }; }
  @Post('schedules/:scheduleId/generate') @Roles(UserRole.CLIENT_ADMIN)
  async generate(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Param('scheduleId') scheduleId: string) {
    const clientId = this.clients.requireClientId(user);
    const schedule = await this.prisma.riderBillingSchedule.findFirst({ where: { id: scheduleId, clientId, riderId } });
    if (!schedule) throw new BadRequestException('BILLING_SCHEDULE_NOT_FOUND');
    return { data: await this.engine.generate(clientId, scheduleId, user.id) };
  }
  @Put('policy') @Roles(UserRole.CLIENT_ADMIN)
  async policy(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Body() dto: BillingPolicyDto) {
    const clientId = this.clients.requireClientId(user);
    const existing = await this.prisma.riderPaymentProfile.findUnique({ where: { clientId_riderId: { clientId, riderId } } });
    if (!existing) throw new BadRequestException('BILLING_ACCOUNT_NOT_FOUND');
    return { data: await this.prisma.$transaction(async tx => {
      const updated = await tx.riderPaymentProfile.update({ where: { id: existing.id }, data: dto });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'RIDER_BILLING_POLICY_UPDATED', entityType: 'RiderPaymentProfile', entityId: updated.id, newData: { billingMode: dto.billingMode, paymentTermsDays: dto.paymentTermsDays, gracePeriodDays: dto.gracePeriodDays } } });
      return updated;
    }) };
  }
  @Post('payments') @Roles(UserRole.CLIENT_ADMIN) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async payment(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Headers('idempotency-key') header: string | undefined, @Body() dto: PaymentDto) { return { data: await this.payments.record(this.clients.requireClientId(user), riderId, user.id, key(header), dto) }; }
  @Get('payments') async history(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string) { return { data: await this.payments.history(this.clients.requireClientId(user), riderId) }; }
  @Post('payments/:paymentId/allocate') @Roles(UserRole.CLIENT_ADMIN)
  async allocate(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Param('paymentId') paymentId: string, @Body() dto: AllocationDto) { return { data: await this.payments.allocate(this.clients.requireClientId(user), riderId, paymentId, user.id, dto) }; }
  @Post('allocations/:allocationId/reverse') @Roles(UserRole.CLIENT_ADMIN)
  async reverse(@CurrentUser() user: AuthUser, @Param('riderId') riderId: string, @Param('allocationId') allocationId: string, @Body() dto: ReverseDto) { return { data: await this.payments.reverseAllocation(this.clients.requireClientId(user), riderId, allocationId, user.id, dto.reason) }; }
  @Put('tax-profile') @Roles(UserRole.CLIENT_ADMIN)
  async taxProfile(@CurrentUser() user: AuthUser, @Body() dto: TaxProfileDto) {
    const clientId = this.clients.requireClientId(user);
    return { data: await this.prisma.$transaction(async tx => {
      const profile = await tx.riderTaxProfile.upsert({ where: { clientId }, create: { clientId, ...dto }, update: dto });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'RIDER_TAX_PROFILE_UPDATED', entityType: 'RiderTaxProfile', entityId: profile.id, newData: { supplierState: dto.supplierState, placeOfSupply: dto.placeOfSupply, supplierGstin: dto.supplierGstin ?? null, customerGstin: dto.customerGstin ?? null } } });
      return profile;
    }) };
  }
  @Post('tax-rules') @Roles(UserRole.CLIENT_ADMIN)
  async taxRule(@CurrentUser() user: AuthUser, @Body() dto: TaxRuleDto) {
    const clientId = this.clients.requireClientId(user);
    const profile = await this.prisma.riderTaxProfile.findUnique({ where: { clientId } });
    if (!profile) throw new BadRequestException('TAX_CONFIGURATION_MISSING');
    const cgst = new Prisma.Decimal(dto.cgstRate), sgst = new Prisma.Decimal(dto.sgstRate), igst = new Prisma.Decimal(dto.igstRate);
    if (cgst.gt(100) || sgst.gt(100) || igst.gt(100) || (igst.gt(0) && (cgst.gt(0) || sgst.gt(0)))) throw new BadRequestException('Invalid tax rates.');
    const effectiveFrom = new Date(dto.effectiveFrom), effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new BadRequestException('Invalid tax rule period.');
    const overlaps = await this.prisma.riderTaxRule.findFirst({ where: { clientId, chargeType: dto.chargeType, effectiveFrom: { lt: effectiveTo ?? new Date('9999-12-31') }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }] } });
    if (overlaps) throw new BadRequestException('Overlapping tax rule.');
    return { data: await this.prisma.$transaction(async tx => {
      const rule = await tx.riderTaxRule.create({ data: { clientId, profileId: profile.id, taxCode: dto.taxCode, chargeType: dto.chargeType, cgstRate: cgst, sgstRate: sgst, igstRate: igst, effectiveFrom, effectiveTo } });
      await tx.auditLog.create({ data: { clientId, actorId: user.id, action: 'RIDER_TAX_RULE_CREATED', entityType: 'RiderTaxRule', entityId: rule.id, newData: { chargeType: rule.chargeType, taxCode: rule.taxCode } } });
      return rule;
    }) };
  }
}

@Controller('rider-app/billing/payment-receipts')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.RIDER)
export class RiderBillingPaymentsAppController {
  constructor(private readonly clients: ClientContextService, private readonly prisma: PrismaService, private readonly payments: RiderPaymentsService) {}
  @Get() async history(@CurrentUser() user: AuthUser) {
    const clientId = this.clients.requireClientId(user);
    const rider = await this.prisma.rider.findFirst({ where: { clientId, userId: user.id, deletedAt: null }, select: { id: true } });
    if (!rider) throw new BadRequestException('Rider profile not found.');
    return { data: await this.payments.history(clientId, rider.id) };
  }
}
