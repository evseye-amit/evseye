import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FleetOwnershipType,
  InsuranceType,
  VehicleSpeedType,
} from '@prisma/client';

export class UpdateFleetDto {
  @IsOptional() @IsString() @MaxLength(50) fleetCode?: string;
  @IsOptional() @IsString() @MaxLength(30) vehicleNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) chassisNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) vinNumber?: string;
  @IsOptional() @IsUUID() oemId?: string;
  @IsOptional() @IsUUID() vehicleCategoryId?: string;
  @IsOptional() @IsUUID() vehicleTypeId?: string;
  @IsOptional() @IsEnum(VehicleSpeedType) speedType?: VehicleSpeedType;
  @IsOptional() @IsString() @MaxLength(100) modelName?: string;
  @IsOptional() @IsString() @MaxLength(100) variantName?: string;
  @IsOptional() @IsString() @MaxLength(50) colour?: string;
  @IsOptional() @IsString() @MaxLength(100) motorNumber?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  manufacturingYear?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  manufacturingMonth?: number;
  @IsOptional() @IsEnum(FleetOwnershipType) ownershipType?: FleetOwnershipType;
  @IsOptional() @IsUUID() homeHubId?: string;
  @IsOptional() @IsUUID() currentHubId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  odometerKm?: number;
  @IsOptional() @IsBoolean() allocationEnabled?: boolean;
  @IsOptional() @IsISO8601() registrationDate?: string;
  @IsOptional() @IsString() @MaxLength(150) registeringAuthority?: string;
  @IsOptional() @IsISO8601() rcExpiryDate?: string;
  @IsOptional() @IsString() @MaxLength(150) insuranceProviderName?: string;
  @IsOptional() @IsString() @MaxLength(100) insurancePolicyNumber?: string;
  @IsOptional() @IsEnum(InsuranceType) insuranceType?: InsuranceType;
  @IsOptional() @IsISO8601() insuranceStartDate?: string;
  @IsOptional() @IsISO8601() insuranceEndDate?: string;
  @IsOptional() @IsString() @MaxLength(100) fitnessCertificateNumber?: string;
  @IsOptional() @IsISO8601() fitnessExpiryDate?: string;
}
