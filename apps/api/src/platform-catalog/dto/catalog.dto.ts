import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsDateString,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FeatureBillingUnit,
  FeatureCategory,
  FeatureType,
  BillingCycle,
  MasterRecordStatus,
  OemType,
  PackageType,
  PricingModel,
} from '@prisma/client';

export class CreateOemDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(40) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(120) displayName!: string;
  @IsEnum(OemType) type!: OemType;
  @IsEnum(MasterRecordStatus) status!: MasterRecordStatus;
  @IsOptional() @IsUrl() logoUrl?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateOemDto extends CreateOemDto {}

export class BulkCreateOemsDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    displayName: string;
    type: OemType;
    status: MasterRecordStatus;
    logoUrl?: string;
    website?: string;
    description?: string;
  }>;
}

export class CreateOemLogoUploadIntentDto {
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsNumber()
  @Min(1)
  @Max(1024 * 1024)
  sizeBytes!: number;
}

export class CompleteOemLogoUploadDto {
  @IsString()
  @Matches(/^platform\/oems\/[0-9a-f-]+\/logo\/[0-9a-f-]+\.(jpeg|png|webp)$/i)
  objectKey!: string;
}

export class CreateFeatureDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(100) code!: string;
  @IsString() @MaxLength(150) name!: string;
  @IsEnum(FeatureCategory) category!: FeatureCategory;
  @IsEnum(FeatureType) featureType!: FeatureType;
  @IsEnum(FeatureBillingUnit) billingUnit!: FeatureBillingUnit;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsNumber() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeatureDto extends CreateFeatureDto {}

export class BulkCreateFeaturesDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    description?: string;
    category: FeatureCategory;
    featureType: FeatureType;
    billingUnit: FeatureBillingUnit;
    displayOrder?: number;
    isActive?: boolean;
  }>;
}

export class CreatePackageDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(50) code!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsNumber() @Min(0) monthlyPrice?: number;
  @IsOptional() @IsNumber() @Min(0) yearlyPrice?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsEnum(PackageType) packageType!: PackageType;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsNumber() @Min(0) maxFleets?: number;
  @IsOptional() @IsNumber() @Min(0) maxVehicles?: number;
  @IsOptional() @IsNumber() @Min(0) maxRiders?: number;
  @IsOptional() @IsNumber() @Min(0) maxUsers?: number;
  @IsOptional() @IsNumber() @Min(0) trialDays?: number;
  @IsOptional() @IsNumber() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) featureIds?: string[];
}

export class UpdatePackageDto extends CreatePackageDto {}

export class CreateFeaturePricingDto {
  @IsString() featureId!: string;
  @IsOptional() @IsString() @MaxLength(150) pricingName?: string;
  @IsEnum(PricingModel) pricingModel!: PricingModel;
  @IsString() @MaxLength(50) billingUnit!: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsNumber() @Min(0) basePrice?: number;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minimumCharge?: number;
  @IsOptional() @IsNumber() @Min(0) maximumCharge?: number;
  @IsOptional() @IsNumber() @Min(0) setupFee?: number;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateFeaturePricingDto extends CreateFeaturePricingDto {}
