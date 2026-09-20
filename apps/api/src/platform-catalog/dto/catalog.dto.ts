import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsUUID,
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
  AllowanceResetPeriod,
  BillingCycle,
  MasterRecordStatus,
  EnergyType,
  VehicleUsageType,
} from '@prisma/client';

export class CreateOemDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(40) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(120) displayName!: string;
  @IsEnum(MasterRecordStatus) status!: MasterRecordStatus;
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
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
  @IsOptional() @IsUUID() featureStepId?: string;
  @IsOptional() @IsNumber() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateFeatureStepDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(100) code!: string;
  @IsString() @MaxLength(150) displayName!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeatureStepDto extends CreateFeatureStepDto {}

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

export class CreatePackageFeatureDto {
  @IsString() featureId!: string;
  @IsOptional() @IsBoolean() isIncluded?: boolean;
  @IsOptional() @IsNumber() @Min(0) includedQuantity?: number;
  @IsOptional() @IsEnum(AllowanceResetPeriod) resetPeriod?: AllowanceResetPeriod;
  @IsOptional() @IsBoolean() isUnlimited?: boolean;
  @IsOptional() @IsBoolean() rolloverAllowed?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}

export class CreatePackageFeatureAssignmentDto extends CreatePackageFeatureDto {
  @IsString() packageId!: string;
}

export class UpdatePackageFeatureDto {
  @IsOptional() @IsBoolean() isIncluded?: boolean;
  @IsOptional() @IsNumber() @Min(0) includedQuantity?: number;
  @IsOptional() @IsEnum(AllowanceResetPeriod) resetPeriod?: AllowanceResetPeriod;
  @IsOptional() @IsBoolean() isUnlimited?: boolean;
  @IsOptional() @IsBoolean() rolloverAllowed?: boolean;
  @IsOptional() @IsObject() configuration?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}

export class CreatePackageDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(50) code!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsNumber() @Min(0) setupFee!: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsInt() @Min(0) maxFleets!: number;
  @IsInt() @Min(0) maxRiders!: number;
  @IsInt() @Min(0) maxAdmins!: number;
  @IsInt() @Min(0) maxFleetManagers!: number;
  @IsInt() @Min(0) maxHubs!: number;
  @IsInt() @Min(0) maxTeamLeaders!: number;
  @IsInt() @Min(0) maxClusterManagers!: number;
  @IsInt() @Min(0) maxUsers!: number;
  @IsOptional() @IsNumber() @Min(0) trialDays?: number;
  @IsOptional() @IsNumber() @Min(0) displayOrder?: number;
  @IsOptional() @IsBoolean() isCustom?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePackageDto extends CreatePackageDto {}

export class BulkCreatePackagesDto {
  @IsArray()
  @ArrayMaxSize(500)
  rows!: Array<{
    code: string;
    name: string;
    setupFee?: number;
    currency?: string;
    maxFleets?: number;
    maxRiders?: number;
    maxAdmins?: number;
    maxFleetManagers?: number;
    maxHubs?: number;
    maxTeamLeaders?: number;
    maxClusterManagers?: number;
    maxUsers?: number;
    trialDays?: number;
    displayOrder?: number;
    isCustom?: boolean;
    isActive?: boolean;
    description?: string;
  }>;
}

export class CreateFeaturePricingDto {
  @IsString() featureId!: string;
  @IsEnum(FeatureBillingUnit) billingUnit!: FeatureBillingUnit;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsNumber() @Min(0) salePrice!: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateFeaturePricingDto extends CreateFeaturePricingDto {}
