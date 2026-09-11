import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MasterRecordStatus, OemType, PricingModel } from '@prisma/client';

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
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(60) code!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(80) category!: string;
  @IsString() @MaxLength(80) featureType!: string;
  @IsString() @MaxLength(60) billingUnit!: string;
  @IsEnum(MasterRecordStatus) status!: MasterRecordStatus;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateFeatureDto extends CreateFeatureDto {}

export class CreatePackageDto {
  @IsString() @Matches(/^[A-Z0-9_-]+$/) @MaxLength(60) code!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsNumber() @Min(0) monthlyPrice!: number;
  @IsOptional() @IsNumber() @Min(0) yearlyPrice?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsEnum(MasterRecordStatus) status!: MasterRecordStatus;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) featureIds?: string[];
}

export class UpdatePackageDto extends CreatePackageDto {}

export class CreateFeaturePricingDto {
  @IsString() featureId!: string;
  @IsEnum(PricingModel) pricingModel!: PricingModel;
  @IsString() @MaxLength(60) billingUnit!: string;
  @IsNumber() @Min(0) unitPrice!: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minCharge?: number;
  @IsOptional() @IsNumber() @Min(0) maxCharge?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeaturePricingDto extends CreateFeaturePricingDto {}
