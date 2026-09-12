import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FeatureBillingUnit,
  FeatureCategory,
  FeatureType,
  BillingCycle,
  MasterRecordStatus,
  EnergyType,
  VehicleUsageType,
  PackageType,
  PricingModel,
} from '@prisma/client';

export class CreateOemDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(40) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(120) displayName!: string;
  @IsEnum(MasterRecordStatus) status!: MasterRecordStatus;
  @IsOptional() @IsUrl() logoUrl?: string;
  @IsOptional() @IsUrl() website?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateOemDto extends CreateOemDto {}

export class CreateVehicleCategoryDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(50) code!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsEnum(MasterRecordStatus) status?: MasterRecordStatus;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}

export class UpdateVehicleCategoryDto extends CreateVehicleCategoryDto {}

export class BulkCreateVehicleCategoriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    description?: string;
    status?: MasterRecordStatus;
    displayOrder?: number;
  }>;
}

export class CreateVehicleTypeDto {
  @IsString() categoryId!: string;
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(50) code!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) subCategory?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsEnum(EnergyType) energyType!: EnergyType;
  @IsOptional() @IsEnum(VehicleUsageType) usageType?: VehicleUsageType;
  @IsOptional() @IsEnum(MasterRecordStatus) status?: MasterRecordStatus;
}
export class UpdateVehicleTypeDto extends CreateVehicleTypeDto {}

export class BulkCreateVehicleTypesDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    categoryCode: string;
    code: string;
    name: string;
    subCategory?: string;
    description?: string;
    energyType: EnergyType;
    usageType?: VehicleUsageType;
    status?: MasterRecordStatus;
  }>;
}

export class BulkCreateOemsDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    displayName: string;
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

export class CreatePackageFeaturePricingDto {
  @IsOptional() @IsString() featurePricingId?: string;
  @IsOptional() @IsEnum(PricingModel) pricingModel?: PricingModel;
  @IsOptional() @IsInt() @Min(0) includedQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minimumCharge?: number;
  @IsOptional() @IsNumber() @Min(0) maximumCharge?: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreatePackageFeatureDto {
  @IsString() featureId!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) includedQuantity?: number;
  @IsOptional() @IsInt() @Min(0) usageLimit?: number;
  @IsOptional() @IsBoolean() unlimitedUsage?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePackageFeaturePricingDto)
  pricing?: CreatePackageFeaturePricingDto[];
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
  // Retained temporarily for compatibility with existing package clients.
  @IsOptional() @IsArray() @IsString({ each: true }) featureIds?: string[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePackageFeatureDto)
  packageFeatures?: CreatePackageFeatureDto[];
}

export class UpdatePackageDto extends CreatePackageDto {}

export class BulkCreatePackagesDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    packageType: PackageType;
    monthlyPrice?: number;
    yearlyPrice?: number;
    currency?: string;
    maxFleets?: number;
    maxVehicles?: number;
    maxRiders?: number;
    maxUsers?: number;
    trialDays?: number;
    displayOrder?: number;
    isDefault?: boolean;
    isActive?: boolean;
    description?: string;
  }>;
}

export class CreateFeaturePricingTierDto {
  @IsInt() @Min(0) tierOrder!: number;
  @IsInt() @Min(0) fromQuantity!: number;
  @IsOptional() @IsInt() @Min(0) toQuantity?: number;
  @IsNumber() @Min(0) unitPrice!: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
}

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
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFeaturePricingTierDto)
  tiers?: CreateFeaturePricingTierDto[];
}

export class UpdateFeaturePricingDto extends CreateFeaturePricingDto {}
