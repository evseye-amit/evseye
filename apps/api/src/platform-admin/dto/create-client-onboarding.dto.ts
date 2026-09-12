import { BillingCycle } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClientOnboardingDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) @MaxLength(80) slug!: string;
  @IsString() @MaxLength(180) legalCompanyName!: string;
  @IsString() @MaxLength(60) clientType!: string;
  @IsString() @MaxLength(60) businessType!: string;
  @IsOptional() @IsString() @MaxLength(80) industry?: string;
  @IsOptional() @IsString() @MaxLength(30) gstin?: string;
  @IsString() @MaxLength(20) pan!: string;
  @IsOptional() @IsString() @MaxLength(30) cinOrLlpin?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsUrl() logoUrl?: string;
  @IsString() @MaxLength(120) primaryContactName!: string;
  @IsString() @MaxLength(100) primaryContactTitle!: string;
  @IsString() @Matches(/^\+?[1-9]\d{7,14}$/) primaryContactMobile!: string;
  @IsString() @MaxLength(180) primaryContactEmail!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  alternateMobile?: string;
  @IsString() @MaxLength(120) adminName!: string;
  @IsString() @MaxLength(180) adminEmail!: string;
  @IsString() @Matches(/^\+?[1-9]\d{7,14}$/) adminMobile!: string;
  @IsString() @MaxLength(180) registeredAddressLine1!: string;
  @IsOptional() @IsString() @MaxLength(180) registeredAddressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) landmark?: string;
  @IsString() @MaxLength(80) city!: string;
  @IsString() @MaxLength(80) district!: string;
  @IsString() @MaxLength(80) state!: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsString() @Matches(/^\d{4,10}$/) pinCode!: string;
  @IsString() packageId!: string;
  @IsEnum(BillingCycle) billingCycle!: BillingCycle;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsIn(['FIXED_AMOUNT', 'PERCENTAGE']) discountType?: string;
  @IsOptional() @IsNumber() @Min(0) discountValue?: number;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
}
