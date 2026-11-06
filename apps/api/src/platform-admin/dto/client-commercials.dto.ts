import { BillingCycle } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateClientCommercialsDto {
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsInt() @Min(0) vehicleCount?: number;
  @IsOptional() @IsNumber() @Min(0) setupFee?: number;
  @IsOptional() @IsNumber() @Min(0) pricePerVehicle?: number;
  @IsOptional() @IsNumber() @Min(0) recurringAmount?: number;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) setupDiscountPercent?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vehicleDiscountPercent?: number;
  @IsOptional() @IsEnum(['PERCENTAGE', 'FIXED_AMOUNT']) setupDiscountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
  @IsOptional() @IsNumber() @Min(0) setupDiscountValue?: number;
  @IsOptional() @IsEnum(['PERCENTAGE', 'FIXED_AMOUNT']) vehicleDiscountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';
  @IsOptional() @IsNumber() @Min(0) vehicleDiscountValue?: number;
}
