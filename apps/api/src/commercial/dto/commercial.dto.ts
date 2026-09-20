import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { BillingCycle, FeatureUsageTransactionType, PricingAdjustmentScope, PricingAdjustmentType, PricingTierMode } from '@prisma/client';

export class VehicleTierDto {
  @IsInt() @Min(1) minVehicles!: number;
  @IsOptional() @IsInt() @Min(1) maxVehicles?: number;
  @IsNumber() @Min(0) pricePerVehicle!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(BillingCycle) billingPeriod?: BillingCycle;
  @IsOptional() @IsEnum(PricingTierMode) tierMode?: PricingTierMode;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class QuoteDto {
  @IsString() clientId!: string;
  @IsString() packageCode!: string;
  @IsInt() @Min(1) vehicleCount!: number;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsDateString() effectiveDate?: string;
}

export class SubscriptionDto extends QuoteDto {
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class VehicleCountDto { @IsInt() @Min(1) vehicleCount!: number; @IsOptional() @IsDateString() effectiveDate?: string; }
export class PackageChangeDto extends VehicleCountDto { @IsString() packageId!: string; }

export class AdjustmentDto {
  @IsString() clientId!: string;
  @IsOptional() @IsString() subscriptionId?: string;
  @IsEnum(PricingAdjustmentScope) adjustmentScope!: PricingAdjustmentScope;
  @IsOptional() @IsString() referenceId?: string;
  @IsEnum(PricingAdjustmentType) adjustmentType!: PricingAdjustmentType;
  @IsNumber() @Min(0) adjustmentValue!: number;
  @IsString() reason!: string;
  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
}

export class FeatureAddOnDto {
  @IsString() code!: string; @IsString() name!: string; @IsOptional() @IsString() description?: string;
  @IsString() featureId!: string; @IsNumber() @Min(0.0001) quantity!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discount?: number;
  @IsOptional() @IsInt() @Min(1) validityDays?: number;
  @IsDateString() effectiveFrom!: string; @IsOptional() @IsDateString() effectiveTo?: string; @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateFeatureAddOnDto extends FeatureAddOnDto {}
export class UpdateActiveStatusDto { @IsBoolean() isActive!: boolean; }

export class PurchaseAddOnDto { @IsString() subscriptionId!: string; @IsString() featureAddOnId!: string; }
export class ConsumeFeatureDto { @IsString() subscriptionId!: string; @IsString() featureCode!: string; @IsNumber() @Min(0.0001) quantity!: number; @IsOptional() @IsString() referenceType?: string; @IsOptional() @IsString() referenceId?: string; @IsOptional() @IsObject() metadata?: Record<string, unknown>; }
